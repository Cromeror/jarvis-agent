import type BetterSqlite3 from "better-sqlite3";

/**
 * Seed the database with demo data for development and validation.
 */
export function seedDatabase(db: BetterSqlite3.Database): void {
  const txn = db.transaction(() => {
    // ------------------------------------------------------------------
    // Cognitive base (only if none exists)
    // ------------------------------------------------------------------
    const existing = db
      .prepare("SELECT COUNT(*) AS cnt FROM cognitive_base")
      .get() as { cnt: number };

    if (existing.cnt === 0) {
      db.prepare(
        `INSERT INTO cognitive_base (content, version, is_active)
         VALUES (?, 1, 1)`,
      ).run(
        [
          "Soy JARVIS, un agente AI que asiste en el desarrollo de software.",
          "Mi objetivo es ayudar a equipos a ser mas productivos manteniendo altos estandares de calidad.",
          "Puedo gestionar proyectos, generar codigo, analizar decisiones tecnicas y coordinar con herramientas externas.",
        ].join("\n"),
      );
    }

    // ------------------------------------------------------------------
    // Demo project
    // ------------------------------------------------------------------
    const projectExists = db
      .prepare("SELECT COUNT(*) AS cnt FROM projects WHERE id = ?")
      .get("demo-ecommerce") as { cnt: number };

    if (projectExists.cnt > 0) return; // already seeded

    db.prepare(
      `INSERT INTO projects (id, name, description, sector, status)
       VALUES (?, ?, ?, ?, 'active')`,
    ).run(
      "demo-ecommerce",
      "Demo E-commerce",
      "Proyecto demo de e-commerce para validar JARVIS",
      "retail",
    );

    // ------------------------------------------------------------------
    // Stack
    // ------------------------------------------------------------------
    const insertStack = db.prepare(
      `INSERT INTO project_stack (project_id, layer, value, notes)
       VALUES (?, ?, ?, ?)`,
    );

    insertStack.run("demo-ecommerce", "frontend", "Next.js 14 + TypeScript", null);
    insertStack.run("demo-ecommerce", "backend", "NestJS + TypeScript", null);
    insertStack.run("demo-ecommerce", "database", "PostgreSQL 16", null);
    insertStack.run("demo-ecommerce", "infra", "Docker + AWS", null);

    // ------------------------------------------------------------------
    // Rules
    // ------------------------------------------------------------------
    const insertRule = db.prepare(
      `INSERT INTO project_rules (project_id, category, rule, priority)
       VALUES (?, ?, ?, ?)`,
    );

    // definition_of_ready
    insertRule.run(
      "demo-ecommerce",
      "definition_of_ready",
      "Toda historia debe tener criterios de aceptacion claros",
      2,
    );
    insertRule.run(
      "demo-ecommerce",
      "definition_of_ready",
      "Las dependencias tecnicas deben estar identificadas",
      1,
    );
    insertRule.run(
      "demo-ecommerce",
      "definition_of_ready",
      "El diseno UI/UX debe estar aprobado",
      0,
    );

    // code_conventions
    insertRule.run(
      "demo-ecommerce",
      "code_conventions",
      "Usar TypeScript strict mode en todos los paquetes",
      2,
    );
    insertRule.run(
      "demo-ecommerce",
      "code_conventions",
      "Nombres de archivos en kebab-case",
      1,
    );
    insertRule.run(
      "demo-ecommerce",
      "code_conventions",
      "Tests unitarios obligatorios para logica de negocio",
      0,
    );

    // git
    insertRule.run(
      "demo-ecommerce",
      "git",
      "Conventional commits: feat|fix|chore|docs|refactor",
      1,
    );
    insertRule.run(
      "demo-ecommerce",
      "git",
      "PRs requieren al menos 1 review aprobado",
      0,
    );

    // ------------------------------------------------------------------
    // Integration
    // ------------------------------------------------------------------
    db.prepare(
      `INSERT INTO project_integrations (project_id, type, key, value, notes)
       VALUES (?, ?, ?, ?, ?)`,
    ).run("demo-ecommerce", "jira", "acli_profile", "demo", null);

    // ------------------------------------------------------------------
    // Knowledge
    // ------------------------------------------------------------------
    db.prepare(
      `INSERT INTO project_knowledge (project_id, title, content, tags)
       VALUES (?, ?, ?, ?)`,
    ).run(
      "demo-ecommerce",
      "Decisiones de arquitectura",
      [
        "## ADR-001: Monorepo con Turborepo",
        "Se decidio usar monorepo para compartir tipos y utilidades entre frontend y backend.",
        "",
        "## ADR-002: PostgreSQL sobre MongoDB",
        "El modelo de datos es relacional (productos, ordenes, usuarios). PostgreSQL ofrece mejor soporte para transacciones y constraints.",
        "",
        "## ADR-003: NestJS para el backend",
        "NestJS provee estructura modular, inyeccion de dependencias y buena integracion con TypeScript.",
      ].join("\n"),
      JSON.stringify(["architecture", "adr", "decisions"]),
    );
  });

  txn();
}
