#!/usr/bin/env node

import { Command } from "commander";
import { runScan } from "./commands/scan.ts";
import { runInfer } from "./commands/infer.ts";
import { runRender } from "./commands/render.ts";
import { runSign } from "./commands/sign.ts";
import { runPack } from "./commands/pack.ts";
import { runVerify } from "./commands/verify.ts";
import { runDoctor } from "./commands/doctor.ts";
import { runScanMulti } from "./commands/scan-multi.ts";

const program = new Command();

program
  .name("veriresume")
  .description("Generate verifiable developer resumes from source code")
  .version("0.1.0");

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
  .description("Generate resume markdown from manifest")
  .argument("[locale]", "Target locale for LLM generation (e.g., zh-TW, ja, en-US)")
  .option("--locale <locale>", "Target locale (alternative to positional argument)")
  .action(async (localeArg: string | undefined, options: { locale?: string }) => {
    const locale = localeArg || options.locale;
    await runRender(process.cwd(), locale);
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
  .action(async (options: { github?: boolean }) => {
    await runScanMulti(process.cwd(), !!options.github);
  });

program.parse();
