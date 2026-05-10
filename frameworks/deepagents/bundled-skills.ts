import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { FileData } from "deepagents";

function isoNow() {
  return new Date().toISOString();
}

export function toVirtualFileData(body: string): FileData {
  const t = isoNow();
  return {
    content: body.split("\n"),
    created_at: t,
    modified_at: t,
  };
}

/**
 * 仓库内 `frameworks/deepagents/skills/` 的绝对路径（依赖 `process.cwd()` 为项目根，与 Next 运行方式一致）。
 * 第三方可直接引用该目录（拷贝、子模块或软链），再在自有工程中登记相同相对结构。
 */
export const BUNDLED_SKILLS_DISK_ROOT = path.join(
  process.cwd(),
  "frameworks/deepagents/skills",
);

/**
 * 列出已安装的 Skill（每个含 `SKILL.md` 的子目录一条），磁盘路径 → 虚拟 `/skills/<slug>/SKILL.md`。
 */
export function listBundledSkillDiskToVirtual(): Array<[string, string]> {
  if (!existsSync(BUNDLED_SKILLS_DISK_ROOT)) return [];

  const pairs: Array<[string, string]> = [];
  const entries = readdirSync(BUNDLED_SKILLS_DISK_ROOT, { withFileTypes: true });

  for (const ent of entries) {
    if (!ent.isDirectory() || ent.name.startsWith(".")) continue;
    const diskRel = `${ent.name}/SKILL.md`;
    const full = path.join(BUNDLED_SKILLS_DISK_ROOT, diskRel);
    if (!existsSync(full)) continue;
    pairs.push([diskRel, `/skills/${ent.name}/SKILL.md`]);
  }

  pairs.sort((a, b) => a[0].localeCompare(b[0]));
  return pairs;
}

/**
 * 某 Skill 目录下所有文件的 [相对 skills 根的路径, 虚拟 POSIX 路径]。
 * 用于第三方 Skill 带子资源（如 references/、examples/）时一并注入虚拟文件系统。
 */
export function listBundledSkillTreeDiskToVirtual(slug: string): Array<[string, string]> {
  const skillAbs = path.join(BUNDLED_SKILLS_DISK_ROOT, slug);
  if (!existsSync(skillAbs)) return [];

  const out: Array<[string, string]> = [];

  function walk(currentAbs: string, relSegments: string[]) {
    const dirEntries = readdirSync(currentAbs, { withFileTypes: true });
    for (const e of dirEntries) {
      if (e.name.startsWith(".")) continue;
      const abs = path.join(currentAbs, e.name);
      if (e.isDirectory()) {
        walk(abs, [...relSegments, e.name]);
      } else if (e.isFile()) {
        const relFromRoot = [slug, ...relSegments, e.name].join("/");
        const virtualRel = [...relSegments, e.name].join("/");
        out.push([relFromRoot, `/skills/${slug}/${virtualRel}`]);
      }
    }
  }

  walk(skillAbs, []);
  out.sort((a, b) => a[0].localeCompare(b[0]));
  return out;
}

/** 读取磁盘上的单个 Skill 原文（UTF-8），便于第三方构建脚本或校验 */
export function readBundledSkillFromDisk(
  relativeToSkillsRoot: string,
): string {
  const full = path.join(BUNDLED_SKILLS_DISK_ROOT, relativeToSkillsRoot);
  return readFileSync(full, "utf8");
}

/** 预置到虚拟文件系统根路径下的 Skills（POSIX 路径）；每个 skill 子目录内文件递归注入 */
export function buildBundledSkillFiles(): Record<string, FileData> {
  const out: Record<string, FileData> = {};
  if (!existsSync(BUNDLED_SKILLS_DISK_ROOT)) return out;

  const entries = readdirSync(BUNDLED_SKILLS_DISK_ROOT, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isDirectory() || ent.name.startsWith(".")) continue;
    const skillMd = path.join(BUNDLED_SKILLS_DISK_ROOT, ent.name, "SKILL.md");
    if (!existsSync(skillMd)) continue;

    for (const [diskRel, virtualPath] of listBundledSkillTreeDiskToVirtual(ent.name)) {
      const body = readBundledSkillFromDisk(diskRel);
      out[virtualPath] = toVirtualFileData(body);
    }
  }

  return out;
}
