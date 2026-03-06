# Render Multi-Format Output

## Summary

Add `--format` and `--output` options to the `render` command to support MD, PDF, PNG, JPEG output using `puppeteer-core` + system Chrome + `marked`.

## Command Interface

```bash
veriresume render [locale] --format <md|pdf|png|jpeg|jpg> --output <path>
```

- `--format` defaults to `md`
- `--output` / `-o` defaults to `./resume.<format>`
- `jpg` accepted as alias for `jpeg`

## Conversion Flow

```
Manifest → render MD → (if not md) → MD→HTML (marked) → HTML→PDF/PNG/JPEG (puppeteer-core + system Chrome)
```

## Chrome Detection

Priority order:
1. `CHROME_PATH` environment variable
2. macOS: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
3. Linux: `google-chrome`, `chromium-browser`, `chromium`
4. Windows: `Program Files` paths

## New Dependencies

- `puppeteer-core` — headless Chrome control (~2MB)
- `marked` — Markdown → HTML conversion

## New Files

| File | Responsibility |
|------|---------------|
| `core/browser.ts` | Chrome path detection, puppeteer-core wrapper |
| `core/export.ts` | MD→HTML→PDF/PNG/JPEG conversion |

## Modified Files

| File | Change |
|------|--------|
| `commands/render.ts` | Add --format, -o options; call export for non-md |
| `src/index.ts` | Update render command options |
| `commands/doctor.ts` | Add Chrome availability check |
