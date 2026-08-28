/**
 * 标签词表：站点允许使用的全部标签，中英文一一对应。
 * 原则：标签只回答「这篇讲什么」，不描述体裁或板块；一篇 1–3 个；
 * 只有预计会有第二篇文章用到的主题才建新标签。
 * 文章 frontmatter 里写本语言的名字；不在词表里的标签会在构建时报错。
 */
export const TAGS = [
  { zh: "AI", en: "AI" },
  { zh: "职业", en: "Career" },
  { zh: "管理", en: "Management" },
  { zh: "工程", en: "Engineering" },
  { zh: "扑克", en: "Poker" },
  { zh: "旅行", en: "Travel" },
  { zh: "学习", en: "Learning" },
  { zh: "人性", en: "Human Nature" },
] as const;

export type Locale = "zh" | "en";

export const tagNames = (locale: Locale) => TAGS.map((t) => t[locale]);

/** 把某语言的标签名换成另一语言的对应名；不在词表里则原样返回 */
export function translateTag(name: string, from: Locale, to: Locale) {
  return TAGS.find((t) => t[from] === name)?.[to] ?? name;
}
