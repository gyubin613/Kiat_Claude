import { handle, json } from "@/lib/api";
import { parseEvaluatorWorkbook } from "@/lib/excel";
import { AppError, findDuplicate, importEvaluators, listEvaluators, type ImportMode } from "@/lib/repo";

export const runtime = "nodejs";

/** dryRun=1 이면 미리보기(검증·중복 확인)만, 아니면 실제 등록 */
export const POST = handle(async (req: Request) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new AppError(400, "엑셀 파일을 선택해 주세요.");
  if (file.size > 5 * 1024 * 1024) throw new AppError(400, "파일 크기는 5MB 이하여야 합니다.");
  const mode = (String(form?.get("mode") || "skip") as ImportMode);
  if (!["skip", "fill", "overwrite"].includes(mode)) throw new AppError(400, "중복 처리 방식이 올바르지 않습니다.");
  const dryRun = String(form?.get("dryRun") || "") === "1";

  let parsed;
  try {
    parsed = await parseEvaluatorWorkbook(await file.arrayBuffer());
  } catch (e) {
    throw new AppError(400, e instanceof Error ? e.message : "파일을 읽지 못했습니다.");
  }
  if (dryRun) {
    const all = await listEvaluators();
    // 파일 내부 중복도 확인
    const seen: { name: string; org: string; email: string; id: string }[] = [];
    const preview = parsed.rows.map((r) => {
      const d = r.data ?? { name: r.raw.name ?? "", org: r.raw.org ?? "", email: r.raw.email ?? "" };
      const dup = findDuplicate(d, all);
      const inFile = findDuplicate(d, seen);
      seen.push({ name: d.name, org: d.org, email: d.email, id: String(r.row) });
      return {
        row: r.row,
        ok: r.ok,
        raw: r.raw,
        errors: r.errors,
        warnings: [...r.warnings, ...(inFile ? [`파일 내 ${inFile.evaluator.id}행과 중복`] : [])],
        duplicate: dup ? { by: dup.by, name: dup.evaluator.name, org: dup.evaluator.org } : null,
      };
    });
    return json({ preview, unmatchedHeaders: parsed.unmatchedHeaders });
  }
  const valid = parsed.rows.filter((r) => r.ok && r.data).map((r) => ({ row: r.row, data: r.data! }));
  const results = await importEvaluators(valid, mode);
  const invalid = parsed.rows.filter((r) => !r.ok).map((r) => ({ row: r.row, name: r.raw.name ?? "", result: "error" as const, message: r.errors.join(", ") }));
  return json({ results: [...results, ...invalid].sort((a, b) => a.row - b.row) });
});
