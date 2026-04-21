import chalk from 'chalk';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Storage } from '@jarvis/storage';
import type { ToolRegistry } from '@jarvis/core';

interface RefineContext {
  storage: Storage;
  toolRegistry: ToolRegistry;
}

// ---------------------------------------------------------------------------
// save <thread_id> <output-file>
// ---------------------------------------------------------------------------

export async function refineSave(
  ctx: RefineContext,
  threadId: string,
  outputFile: string,
  opts: { instructions?: string; requirements?: string; project?: string },
): Promise<void> {
  let output: string;
  try {
    output = await readFile(outputFile, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Error al leer el archivo de output "${outputFile}": ${msg}`));
    process.exit(1);
  }

  let requirements: string | undefined;
  if (opts.requirements) {
    try {
      requirements = await readFile(opts.requirements, 'utf-8');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Error al leer el archivo de requerimientos "${opts.requirements}": ${msg}`));
      process.exit(1);
    }
  }

  const input: Record<string, unknown> = {
    thread_id: threadId,
    output,
  };
  if (opts.instructions) input['instructions'] = opts.instructions;
  if (requirements) input['requirements'] = requirements;
  if (opts.project) input['project_id'] = opts.project;

  let result: string;
  try {
    result = await ctx.toolRegistry.execute('refine_save_iteration', input);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Translate known English error patterns to Spanish
    const translated = msg
      .replace(/Thread (.+) no existe/, 'El hilo $1 no existe')
      .replace(/El hilo (.+) ya está finalizado y no admite nuevas iteraciones/,
        'El hilo $1 ya está finalizado y no admite nuevas iteraciones');
    console.error(chalk.red(`Error: ${translated}`));
    process.exit(1);
  }

  let row: { iteration?: number; thread_id?: string; status?: string };
  try {
    row = JSON.parse(result);
  } catch {
    console.error(chalk.red('Error al parsear la respuesta del servidor.'));
    process.exit(1);
  }

  console.log(
    chalk.green(
      `✔ Iteración ${row.iteration ?? '?'} guardada en hilo ${row.thread_id ?? threadId} (status: ${row.status ?? '?'})`,
    ),
  );
}

// ---------------------------------------------------------------------------
// iterate [thread_id]
// ---------------------------------------------------------------------------

export async function refineIterate(
  ctx: RefineContext,
  threadId: string | undefined,
  opts: { input?: string; instructions?: string; project?: string },
): Promise<void> {
  if (!opts.input) {
    console.error(chalk.red('Error: se requiere --input <archivo> con los requerimientos.'));
    process.exit(1);
  }

  let requirements: string;
  try {
    requirements = await readFile(opts.input, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Error al leer el archivo de requerimientos "${opts.input}": ${msg}`));
    process.exit(1);
  }

  const resolvedThreadId = threadId ?? randomUUID();
  if (!threadId) {
    console.log(chalk.cyan(`Nuevo hilo: ${resolvedThreadId}`));
  }

  const input: Record<string, unknown> = {
    requirements,
    thread_id: resolvedThreadId,
  };
  if (opts.instructions) input['instructions'] = opts.instructions;
  if (opts.project) input['project_id'] = opts.project;

  let prompt: string;
  try {
    prompt = await ctx.toolRegistry.execute('refine_requirements', input);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Error al refinar requerimientos: ${msg}`));
    process.exit(1);
  }

  console.log(prompt);

  // Extract iteration number from the meta header
  const iterMatch = prompt.match(/iteration:\s*(\d+)/);
  const nextIter = iterMatch ? iterMatch[1] : '?';

  console.log(
    `\n---\nHilo: ${resolvedThreadId} · Iteración próxima: ${nextIter}\n` +
    `Guardar con:  jarvis refine save ${resolvedThreadId} <archivo-output>`,
  );
}

// ---------------------------------------------------------------------------
// list <thread_id>
// ---------------------------------------------------------------------------

export async function refineList(
  ctx: RefineContext,
  threadId: string,
): Promise<void> {
  let result: string;
  try {
    result = await ctx.toolRegistry.execute('refine_list_iterations', { thread_id: threadId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Error al listar iteraciones: ${msg}`));
    process.exit(1);
  }

  let rows: Array<{
    iteration: number;
    status: string;
    created_at: string;
    output: string | null;
  }>;
  try {
    rows = JSON.parse(result);
  } catch {
    console.error(chalk.red('Error al parsear la respuesta del servidor.'));
    process.exit(1);
  }

  if (!rows || rows.length === 0) {
    console.log(chalk.yellow(`Hilo ${threadId} no tiene iteraciones.`));
    return;
  }

  // Table header
  const header = `${'Iter'.padEnd(6)}${'Status'.padEnd(10)}${'Creada'.padEnd(22)}Output (preview)`;
  console.log(chalk.bold('\n' + header));
  console.log(chalk.gray('─'.repeat(header.length)));

  for (const row of rows) {
    const rawOutput = row.output ?? '';
    const preview = rawOutput.replace(/\n/g, ' ').slice(0, 60) + (rawOutput.length > 60 ? '…' : '');
    const statusPadded = row.status.padEnd(10);
    const statusColored = row.status === 'final' ? chalk.green(statusPadded) : chalk.yellow(statusPadded);
    console.log(
      `${String(row.iteration).padEnd(6)}${statusColored}${row.created_at.slice(0, 19).padEnd(22)}${preview}`,
    );
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// show <thread_id>
// ---------------------------------------------------------------------------

export async function refineShow(
  ctx: RefineContext,
  threadId: string,
  opts: { iteration?: string },
): Promise<void> {
  let output: string | null;
  let instructions: string | null = null;

  if (opts.iteration !== undefined) {
    const iterNum = parseInt(opts.iteration, 10);
    if (isNaN(iterNum)) {
      console.error(chalk.red(`Error: el número de iteración "${opts.iteration}" no es válido.`));
      process.exit(1);
    }

    // Fetch all iterations and find the requested one
    let listResult: string;
    try {
      listResult = await ctx.toolRegistry.execute('refine_list_iterations', { thread_id: threadId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Error al obtener iteraciones: ${msg}`));
      process.exit(1);
    }

    let rows: Array<{ iteration: number; output: string | null; instructions: string | null }>;
    try {
      rows = JSON.parse(listResult);
    } catch {
      console.error(chalk.red('Error al parsear la respuesta del servidor.'));
      process.exit(1);
    }

    const found = rows.find(r => r.iteration === iterNum);
    if (!found) {
      console.error(chalk.red(`Error: la iteración ${iterNum} no existe en el hilo ${threadId}.`));
      process.exit(1);
    }

    output = found.output;
    instructions = found.instructions;
  } else {
    // Use the latest iteration
    let result: string;
    try {
      result = await ctx.toolRegistry.execute('refine_get_latest', { thread_id: threadId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Error al obtener la última iteración: ${msg}`));
      process.exit(1);
    }

    let row: { output: string | null; instructions: string | null } | null;
    try {
      row = JSON.parse(result);
    } catch {
      console.error(chalk.red('Error al parsear la respuesta del servidor.'));
      process.exit(1);
    }

    if (!row) {
      console.error(chalk.red(`No hay iteraciones en el hilo ${threadId}.`));
      process.exit(1);
    }

    output = row.output;
    instructions = row.instructions;
  }

  // Print output to stdout (pipe-friendly)
  if (output) {
    process.stdout.write(output + '\n');
  }

  // Print instructions to stderr so stdout stays pipe-friendly
  if (instructions) {
    process.stderr.write(`\n---\nInstrucciones:\n${instructions}\n`);
  }
}

// ---------------------------------------------------------------------------
// finalize <thread_id>
// ---------------------------------------------------------------------------

export async function refineFinalize(
  ctx: RefineContext,
  threadId: string,
): Promise<void> {
  try {
    await ctx.toolRegistry.execute('refine_finalize', { thread_id: threadId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Translate English error to Spanish
    if (msg.includes('no existe')) {
      console.error(chalk.red(`Error: el hilo ${threadId} no existe.`));
    } else {
      console.error(chalk.red(`Error al finalizar el hilo: ${msg}`));
    }
    process.exit(1);
  }

  console.log(chalk.green(`✔ Hilo ${threadId} finalizado. No se admitirán nuevas iteraciones.`));
}
