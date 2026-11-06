"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Evaluator, Invite } from "@/lib/types";
import { api, errMsg, useToast } from "./ui";

/** 현재 평가의 초청 목록과 평가위원 명단을 함께 불러온다 */
export function useEvalData(evalId: string | undefined, opts: { pollMs?: number } = {}) {
  const toast = useToast();
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [evaluators, setEvaluators] = useState<Evaluator[] | null>(null);

  const reload = useCallback(async () => {
    if (!evalId) return;
    try {
      const [a, b] = await Promise.all([
        api<{ invites: Invite[] }>(`/api/admin/evaluations/${evalId}/invites`),
        api<{ evaluators: Evaluator[] }>(`/api/admin/evaluations/${evalId}/evaluators`),
      ]);
      setInvites(a.invites);
      setEvaluators(b.evaluators);
    } catch (e) {
      toast(errMsg(e), "bad");
    }
  }, [evalId, toast]);

  useEffect(() => {
    setInvites(null);
    reload();
  }, [reload]);

  // 다른 화면·평가위원 회신을 반영하기 위해 창이 다시 활성화될 때 갱신
  useEffect(() => {
    const onFocus = () => document.visibilityState === "visible" && reload();
    document.addEventListener("visibilitychange", onFocus);
    return () => document.removeEventListener("visibilitychange", onFocus);
  }, [reload]);

  // 회신 현황 화면 등에서 주기적으로 갱신 (화면이 보일 때만)
  const { pollMs } = opts;
  useEffect(() => {
    if (!pollMs) return;
    const t = setInterval(() => document.visibilityState === "visible" && reload(), pollMs);
    return () => clearInterval(t);
  }, [pollMs, reload]);

  const byId = useMemo(() => new Map((evaluators ?? []).map((v) => [v.id, v])), [evaluators]);
  return { invites, evaluators, byId, reload, ready: invites !== null && evaluators !== null };
}
