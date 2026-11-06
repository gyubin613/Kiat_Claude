"use client";
import { useRef, useState } from "react";
import type { LoadedFile } from "@/lib/mail";

export async function readFiles(list: FileList | File[]): Promise<LoadedFile[]> {
  const files = Array.from(list);
  return Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
}

export function Dropzone({
  accept,
  multiple,
  label,
  hint,
  onFiles,
  disabled,
}: {
  accept: string;
  multiple?: boolean;
  label: string;
  hint: string;
  onFiles: (files: LoadedFile[]) => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      className={`drop${over ? " over" : ""}`}
      role="button"
      tabIndex={0}
      aria-disabled={disabled}
      onClick={() => !disabled && input.current?.click()}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !disabled) {
          e.preventDefault();
          input.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setOver(false);
        if (disabled || !e.dataTransfer.files.length) return;
        onFiles(await readFiles(e.dataTransfer.files));
      }}
    >
      <strong>{label}</strong>
      <div>{hint}</div>
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        onChange={async (e) => {
          if (e.target.files?.length) onFiles(await readFiles(e.target.files));
          e.target.value = "";
        }}
      />
    </div>
  );
}
