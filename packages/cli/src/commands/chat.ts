import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import chalk from 'chalk';
import ora from 'ora';
import { Marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import type { JarvisAgent } from '@jarvis/agent';
import type { Storage } from '@jarvis/storage';

const marked = new Marked(markedTerminal() as any);

export async function chatCommand(
  agent: JarvisAgent,
  storage: Storage,
  options: { project?: string; resume?: boolean }
): Promise<void> {
  let session;

  if (options.resume) {
    // Get most recent session
    const sessions = storage.sessions.list();
    if (sessions.length === 0) {
      console.log(chalk.yellow('No previous sessions found. Starting new session.'));
      session = await agent.startSession(options.project);
    } else {
      session = sessions[0];
      console.log(chalk.green(`Resuming session: ${session.title || session.id}`));
    }
  } else {
    session = await agent.startSession(options.project);
  }

  // Show welcome
  if (options.project) {
    const ctx = storage.projects.getFullContext(options.project);
    if (ctx) {
      const stackStr = ctx.stack.map(s => s.value).join(' + ');
      console.log(chalk.cyan.bold(`\nJARVIS > Contexto cargado: ${ctx.project.name} | Stack: ${stackStr}`));
    } else {
      console.log(chalk.yellow(`Project '${options.project}' not found.`));
    }
  }
  console.log(chalk.cyan('JARVIS > ¿En qué trabajamos?\n'));

  const rl = createInterface({ input: stdin, output: stdout });

  try {
    while (true) {
      const input = await rl.question(chalk.white.bold('Tú > '));
      const trimmed = input.trim();

      if (!trimmed) continue;
      if (trimmed === '/exit' || trimmed === '/quit') break;
      if (trimmed === '/clear') {
        session = await agent.startSession(options.project);
        console.log(chalk.cyan('\nJARVIS > Nueva sesión iniciada.\n'));
        continue;
      }
      if (trimmed === '/project') {
        if (session.project_id) {
          const ctx = storage.projects.getFullContext(session.project_id);
          if (ctx) {
            console.log(chalk.cyan(`\nProyecto: ${ctx.project.name} (${ctx.project.sector})`));
            console.log(chalk.cyan(`Stack: ${ctx.stack.map(s => `${s.layer}: ${s.value}`).join(', ')}\n`));
          }
        } else {
          console.log(chalk.yellow('\nNo project active in this session.\n'));
        }
        continue;
      }

      const spinner = ora({ text: 'Pensando...', color: 'cyan' }).start();
      try {
        const response = await agent.run(trimmed, session.id);
        spinner.stop();
        const rendered = marked.parse(response) as string;
        console.log(`\n${chalk.cyan.bold('JARVIS >')} ${rendered}\n`);
      } catch (err) {
        spinner.fail('Error');
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : err}\n`));
      }
    }
  } finally {
    rl.close();
  }

  console.log(chalk.cyan('\nJARVIS > ¡Hasta luego!\n'));
}
