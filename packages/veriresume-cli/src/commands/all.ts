import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runScan } from "./scan.ts";
import { runScanMulti } from "./scan-multi.ts";
import { runInfer } from "./infer.ts";
import { runRender } from "./render.ts";
import { runSign } from "./sign.ts";
import { runPack } from "./pack.ts";
import { runVerify } from "./verify.ts";
import { selectPrompt, ask } from "../core/prompt.ts";
import { resolveApiKey, readConfig, writeConfig } from "../core/config.ts";
import { askYesNo } from "../core/prompt.ts";

const execFileAsync = promisify(execFile);

type ScanMode = "current" | "local-multi" | "github";

export async function runAll(
  cwd: string,
  options?: {
    locale?: string; format?: string; output?: string;
    scanMode?: ScanMode; parentDir?: string;
    repos?: string[]; emails?: string[];
    displayName?: string; contactEmail?: string;
    skipLlm?: boolean;
    maxReviewTokens?: number; yes?: boolean; dryRun?: boolean;
  },
): Promise<void> {
  const steps = [
    "Scanning repository",
    "Inferring skills",
    "Signing manifest",
    "Rendering resume",
    "Packing bundle",
    "Verifying bundle",
  ];

  let currentStep = 0;
  const step = (name: string) => {
    currentStep++;
    console.log(`\n[${currentStep}/${steps.length}] ${name}...`);
  };

  try {
    // Pre-check: Anthropic API key (skip if skipLlm is set, e.g. in tests)
    if (!options?.skipLlm) {
      let apiKey = await resolveApiKey(cwd);
      if (!apiKey) {
        console.log("Anthropic API key is required for LLM-based skill analysis.");
        apiKey = await ask("Enter your Anthropic API key: ");
        if (!apiKey) {
          console.error("Error: Anthropic API key is required. Cannot proceed without it.");
          process.exitCode = 1;
          return;
        }
        const save = await askYesNo("Save to .veriresume/config.json for future use?");
        if (save) {
          const config = await readConfig(cwd);
          config.anthropic_api_key = apiKey;
          await writeConfig(cwd, config);
          console.log("Key saved.");
        }
      }
      console.log("Anthropic API key found. LLM analysis enabled.");
    }

    // Step 1: Scan — choose mode
    const scanMode = options?.scanMode ?? await selectPrompt<ScanMode>(
      "How would you like to scan?",
      [
        { name: "Current project only", value: "current" },
        { name: "Multiple local projects", value: "local-multi" },
        { name: "GitHub remote repos", value: "github" },
      ],
    );

    step("Scanning repository");

    if (scanMode === "current") {
      try {
        await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd });
      } catch {
        console.error("Error: Not a git repository. Please run this command inside a git project.");
        process.exitCode = 1;
        return;
      }
      await runScan(cwd);
    } else if (scanMode === "local-multi") {
      const parentDir = options?.parentDir ?? await ask("Parent directory path (press Enter for current directory): ");
      await runScanMulti(parentDir || cwd, false, {
        repos: options?.repos,
        emails: options?.emails,
      });
    } else {
      await runScanMulti(cwd, true);
    }

    // Step 2: Infer
    step("Inferring skills");
    await runInfer(cwd, {
      skipLlm: options?.skipLlm,
      maxReviewTokens: options?.maxReviewTokens,
      yes: options?.yes,
      dryRun: options?.dryRun,
    });

    // Step 3: Render — interactive prompts
    let locale = options?.locale;
    let format = options?.format;
    let output = options?.output;

    if (!options?.skipLlm) {
      if (!locale) {
        locale = (await ask("Locale for resume (e.g., en-US, zh-TW — press Enter to skip): ")) || undefined;
      }

      if (!format) {
        format = await selectPrompt<string>(
          "Output format",
          [
            { name: "md (default)", value: "md" },
            { name: "pdf", value: "pdf" },
            { name: "png", value: "png" },
            { name: "jpeg", value: "jpeg" },
          ],
        );
      }

      if (!output) {
        const ext = (format === "jpeg" ? "jpg" : format) || "md";
        const defaultOutput = path.join(cwd, `resume.${ext}`);
        const outputAnswer = await ask(`Output path (default: ${defaultOutput}): `);
        output = outputAnswer || defaultOutput;
      }
    }

    if (!output) {
      const ext = (format === "jpeg" ? "jpg" : format) || "md";
      output = path.join(cwd, `resume.${ext}`);
    }

    // Step 3: Sign (before render so verification block shows signature)
    step("Signing manifest");
    await runSign(cwd);

    // Step 4: Render
    step("Rendering resume");
    const hasCliFlags = !!(options?.locale && options?.format && options?.output);
    const renderOpts: Parameters<typeof runRender>[4] = {
      yes: options?.skipLlm || hasCliFlags || false,
      displayName: options?.displayName,
      contactEmail: options?.contactEmail,
    };
    await runRender(cwd, locale, format, output, renderOpts);

    // Step 5: Pack
    step("Packing bundle");
    await runPack(cwd);

    // Step 6: Verify
    const bundlePath = path.join(cwd, "bundle.zip");
    step("Verifying bundle");
    await runVerify(bundlePath);

    console.log("\nAll done! Bundle ready at: " + bundlePath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\nFailed at step [${currentStep}/${steps.length}] ${steps[currentStep - 1]}: ${message}`);
    process.exitCode = 1;
  }
}
