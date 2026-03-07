#!/usr/bin/env node

import path from "node:path";
import { Command } from "commander";
import { runScan } from "./commands/scan.ts";
import { runInfer } from "./commands/infer.ts";
import { runRender } from "./commands/render.ts";
import { runSign } from "./commands/sign.ts";
import { runPack } from "./commands/pack.ts";
import { runVerify } from "./commands/verify.ts";
import { runDoctor } from "./commands/doctor.ts";
import { runScanMulti } from "./commands/scan-multi.ts";
import { runAll } from "./commands/all.ts";
import { discoverLocalRepos } from "./commands/scan-multi.ts";
import { collectAllEmails } from "./core/identity.ts";

const program = new Command();

program
  .name("veriresume")
  .description("Generate verifiable developer resumes from source code")
  .version("0.1.23");

program
  .command("scan")
  .description("Scan repository and generate evidence graph")
  .action(async () => {
    await runScan(process.cwd());
  });

program
  .command("infer-skills")
  .description("Infer skills from evidence using static signals")
  .action(async () => {
    await runInfer(process.cwd());
  });

program
  .command("render")
  .description("Generate resume from manifest (supports md, pdf, png, jpeg)")
  .argument("[locale]", "Target locale for LLM generation (e.g., zh-TW, ja, en-US)")
  .option("--locale <locale>", "Target locale (alternative to positional argument)")
  .option("--format <format>", "Output format: md, pdf, png, jpeg, jpg (default: md)")
  .option("-o, --output <path>", "Output file path")
  .option("--api-key <key>", "Anthropic API key (skips interactive prompt)")
  .option("--personal-info <info>", "Personal info to include (skips interactive prompt)")
  .option("--yes", "Skip all interactive prompts (CI mode)")
  .action(async (localeArg: string | undefined, options: { locale?: string; format?: string; output?: string; apiKey?: string; personalInfo?: string; yes?: boolean }) => {
    const locale = localeArg || options.locale;
    await runRender(process.cwd(), locale, options.format, options.output, {
      apiKey: options.apiKey,
      personalInfo: options.personalInfo,
      yes: options.yes,
    });
  });

program
  .command("sign")
  .description("Sign resume manifest with Ed25519 key")
  .action(async () => {
    await runSign(process.cwd());
  });

program
  .command("pack")
  .description("Create distributable resume bundle")
  .action(async () => {
    await runPack(process.cwd());
  });

program
  .command("verify")
  .description("Verify resume bundle authenticity")
  .argument("<bundle>", "Path to bundle.zip")
  .action(async (bundle: string) => {
    await runVerify(bundle);
  });

program
  .command("doctor")
  .description("Check prerequisites for using VeriResume")
  .action(async () => {
    await runDoctor();
  });

program
  .command("scan-multi")
  .description("Scan multiple repositories and merge into one resume")
  .option("--github", "Scan remote GitHub repositories instead of local sub-directories")
  .option("--path <dir>", "Parent directory containing git repositories (default: current directory)")
  .action(async (options: { github?: boolean; path?: string }) => {
    const targetDir = options.path ? path.resolve(options.path) : process.cwd();
    await runScanMulti(targetDir, !!options.github);
  });

program
  .command("list-repos")
  .description("Discover git repositories under a directory and output as JSON")
  .option("--path <dir>", "Parent directory to scan (default: current directory)")
  .action(async (options: { path?: string }) => {
    const targetDir = options.path ? path.resolve(options.path) : process.cwd();
    const repos = await discoverLocalRepos(targetDir);
    console.log(JSON.stringify(repos.map((r) => r.name)));
  });

program
  .command("list-emails")
  .description("Collect all git emails from specified repos and output as JSON")
  .option("--path <dir>", "Parent directory containing repos")
  .option("--repos <names>", "Comma-separated repo names")
  .action(async (options: { path?: string; repos?: string }) => {
    const parentDir = options.path ? path.resolve(options.path) : process.cwd();
    const allRepos = await discoverLocalRepos(parentDir);
    let targetRepos = allRepos;
    if (options.repos) {
      const names = new Set(options.repos.split(",").map((s) => s.trim()));
      targetRepos = allRepos.filter((r) => names.has(r.name));
    }
    const emails = await collectAllEmails(targetRepos);
    console.log(JSON.stringify(emails.map((e) => e.email)));
  });

program
  .command("all")
  .description("Run full pipeline: scan → infer → render → sign → pack → verify")
  .option("--scan-mode <mode>", "Scan mode: current, local-multi, github")
  .option("--parent-dir <dir>", "Parent directory for local-multi scan")
  .option("--repos <names>", "Comma-separated repo names (skips interactive selection)")
  .option("--emails <addrs>", "Comma-separated email addresses (skips interactive selection)")
  .option("--locale <locale>", "Resume locale (e.g., en-US, zh-TW)")
  .option("--format <format>", "Output format: md, pdf, png, jpeg")
  .option("-o, --output <path>", "Output file path")
  .action(async (options: {
    scanMode?: string; parentDir?: string;
    repos?: string; emails?: string;
    locale?: string; format?: string; output?: string;
  }) => {
    await runAll(process.cwd(), {
      scanMode: options.scanMode as "current" | "local-multi" | "github" | undefined,
      parentDir: options.parentDir ? path.resolve(options.parentDir) : undefined,
      repos: options.repos ? options.repos.split(",").map((s) => s.trim()) : undefined,
      emails: options.emails ? options.emails.split(",").map((s) => s.trim()) : undefined,
      locale: options.locale,
      format: options.format,
      output: options.output,
    });
  });

program.parse();
