import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Storage } from '../index.js';

interface DefaultKnowledgeEntry {
  slug: string;
  file: string;
  title: string;
  tags?: string[];
  applyTo: string;
}

interface DefaultRuleEntry {
  slug: string;
  file: string;
  category: string;
  priority?: number;
  toolName?: string | null;
  applyTo: string;
}

interface DefaultsManifest {
  version: number;
  knowledge?: DefaultKnowledgeEntry[];
  rules?: DefaultRuleEntry[];
}

export interface ApplyDefaultsOptions {
  /** Apply only to this project id. If omitted, applies to all projects. */
  projectId?: string;
  /** Overwrite existing entries that match by slug. Default: false (skip). */
  force?: boolean;
}

export interface ApplyDefaultsResult {
  appliedKnowledge: Array<{ projectId: string; slug: string; action: 'inserted' | 'updated' | 'skipped' }>;
  appliedRules: Array<{ projectId: string; slug: string; action: 'inserted' | 'updated' | 'skipped' }>;
}

const SLUG_TAG_PREFIX = 'default-seed:';

function defaultsDir(): string {
  // Resolve seeds/ relative to this file's location.
  // After tsc build, this lives at dist/seeds/apply-defaults.js and the
  // `seeds/defaults/` directory is a sibling (copied there by copy-seeds.mjs).
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, 'defaults');
}

function readManifest(): DefaultsManifest {
  const manifestPath = resolve(defaultsDir(), 'manifest.json');
  const raw = readFileSync(manifestPath, 'utf-8');
  return JSON.parse(raw) as DefaultsManifest;
}

function readAsset(relativePath: string): string {
  return readFileSync(resolve(defaultsDir(), relativePath), 'utf-8');
}

function projectMatchesSelector(
  storage: Storage,
  projectId: string,
  selector: string,
): boolean {
  if (selector === 'all') return true;
  if (selector.startsWith('project:')) {
    return selector.slice('project:'.length) === projectId;
  }
  if (selector.startsWith('integration:')) {
    const service = selector.slice('integration:'.length);
    const integrations = storage.integrations.list(projectId);
    return integrations.some((i) => i.service === service);
  }
  return false;
}

function listTargetProjects(storage: Storage, projectId?: string): string[] {
  if (projectId) return [projectId];
  return storage.projects.list().map((p) => p.id);
}

function slugTag(slug: string): string {
  return `${SLUG_TAG_PREFIX}${slug}`;
}

function findKnowledgeBySlug(
  storage: Storage,
  projectId: string,
  slug: string,
): { id: number } | null {
  const ctx = storage.projects.getFullContext(projectId);
  if (!ctx) return null;
  const target = slugTag(slug);
  const match = ctx.knowledge.find((k) => {
    if (!k.tags) return false;
    try {
      const parsed: unknown = typeof k.tags === 'string' ? JSON.parse(k.tags) : k.tags;
      if (!Array.isArray(parsed)) return false;
      return parsed.includes(target);
    } catch {
      return false;
    }
  });
  return match ? { id: match.id } : null;
}

function applyKnowledge(
  storage: Storage,
  projectId: string,
  entry: DefaultKnowledgeEntry,
  force: boolean,
): 'inserted' | 'updated' | 'skipped' {
  const content = readAsset(entry.file);
  const tags = [...(entry.tags ?? []), slugTag(entry.slug)];
  const existing = findKnowledgeBySlug(storage, projectId, entry.slug);

  if (existing) {
    if (!force) return 'skipped';
    // Replace: delete + re-add, because repo.update has known quirks
    // with large content (see commit history).
    storage.knowledge.remove(existing.id);
    storage.knowledge.add(projectId, entry.title, content, tags);
    return 'updated';
  }

  storage.knowledge.add(projectId, entry.title, content, tags);
  return 'inserted';
}

export function applyDefaults(
  storage: Storage,
  options: ApplyDefaultsOptions = {},
): ApplyDefaultsResult {
  const manifest = readManifest();
  const force = options.force ?? false;
  const projects = listTargetProjects(storage, options.projectId);

  const appliedKnowledge: ApplyDefaultsResult['appliedKnowledge'] = [];
  const appliedRules: ApplyDefaultsResult['appliedRules'] = [];

  for (const projectId of projects) {
    for (const entry of manifest.knowledge ?? []) {
      if (!projectMatchesSelector(storage, projectId, entry.applyTo)) continue;
      try {
        const action = applyKnowledge(storage, projectId, entry, force);
        appliedKnowledge.push({ projectId, slug: entry.slug, action });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[defaults] Failed to apply knowledge "${entry.slug}" to ${projectId}: ${msg}`);
      }
    }

    // Rules: scaffold only, not used yet.
    for (const entry of manifest.rules ?? []) {
      if (!projectMatchesSelector(storage, projectId, entry.applyTo)) continue;
      // TODO: implement rules application when the first default rule exists.
      appliedRules.push({ projectId, slug: entry.slug, action: 'skipped' });
    }
  }

  return { appliedKnowledge, appliedRules };
}
