import JSZip from "jszip";
import type { TocEntry } from "@/lib/supabase/types";
import { wrapSentences } from "./sentences";
import type { EpubChapter, ManifestItem, ParsedEpub } from "./types";

function resolvePath(baseDir: string, relative: string): string {
  const stack = baseDir.split("/").filter(Boolean);
  for (const part of relative.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

function stripFragment(path: string): string {
  return path.split("#")[0];
}

function guessImageMimeType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "svg":
      return "image/svg+xml";
    case "webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

/**
 * Chapter HTML references images by path relative to the EPUB's internal
 * zip structure (e.g. "../images/fig1.jpg"), which the browser can't
 * resolve on its own. Replace every <img src> / <image href> with an
 * object URL for the actual image bytes pulled out of the zip, so pictures
 * render instead of a broken-image icon.
 */
async function resolveChapterImages(zip: JSZip, root: Element, chapterHref: string): Promise<void> {
  const baseDir = dirname(chapterHref);

  async function resolveAttr(el: Element, attr: string): Promise<void> {
    const raw = el.getAttribute(attr);
    if (!raw || /^(data|https?|blob):/i.test(raw)) return;

    const resolved = resolvePath(baseDir, decodeURIComponent(stripFragment(raw)));
    const file = zip.file(resolved);
    if (!file) return;

    const buffer = await file.async("arraybuffer");
    const url = URL.createObjectURL(new Blob([buffer], { type: guessImageMimeType(resolved) }));
    el.setAttribute(attr, url);
  }

  const tasks: Promise<void>[] = [];
  root.querySelectorAll("img").forEach((el) => tasks.push(resolveAttr(el, "src")));
  root.querySelectorAll("image").forEach((el) => {
    const attr = el.hasAttribute("href") ? "href" : "xlink:href";
    tasks.push(resolveAttr(el, attr));
  });

  await Promise.all(tasks);
}

export async function parseEpub(file: File | Blob): Promise<ParsedEpub> {
  const zip = await JSZip.loadAsync(file);

  const containerXml = await zip.file("META-INF/container.xml")?.async("string");
  if (!containerXml) throw new Error("Invalid EPUB: missing META-INF/container.xml");
  const containerDoc = new DOMParser().parseFromString(containerXml, "application/xml");
  const opfPath = containerDoc.querySelector("rootfile")?.getAttribute("full-path");
  if (!opfPath) throw new Error("Invalid EPUB: no rootfile declared in container.xml");

  const opfXml = await zip.file(opfPath)?.async("string");
  if (!opfXml) throw new Error("Invalid EPUB: missing OPF package file");
  const opfDoc = new DOMParser().parseFromString(opfXml, "application/xml");
  const opfDir = dirname(opfPath);

  const title =
    opfDoc.getElementsByTagName("dc:title")[0]?.textContent?.trim() || "Untitled";
  const author = opfDoc.getElementsByTagName("dc:creator")[0]?.textContent?.trim() || null;

  const manifest = new Map<string, ManifestItem>();
  Array.from(opfDoc.getElementsByTagName("item")).forEach((item) => {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (!id || !href) return;
    manifest.set(id, {
      id,
      href: resolvePath(opfDir, href),
      mediaType: item.getAttribute("media-type") || "",
      properties: item.getAttribute("properties") || undefined,
    });
  });

  const spineEl = opfDoc.getElementsByTagName("spine")[0];
  const spineIdrefs = Array.from(spineEl?.getElementsByTagName("itemref") ?? [])
    .map((el) => el.getAttribute("idref"))
    .filter((v): v is string => !!v);

  const { coverBlob, coverMediaType } = await resolveCover(zip, opfDoc, manifest);

  const chapters: EpubChapter[] = [];
  for (let spineIndex = 0; spineIndex < spineIdrefs.length; spineIndex++) {
    const item = manifest.get(spineIdrefs[spineIndex]);
    if (!item) continue;
    const raw = await zip.file(item.href)?.async("string");
    if (raw == null) continue;

    const doc = new DOMParser().parseFromString(raw, "text/html");
    const body = doc.body ?? doc.documentElement;
    body.querySelectorAll("script").forEach((n) => n.remove());
    await resolveChapterImages(zip, body, item.href);

    const sentences = wrapSentences(body);
    const chapterTitle =
      doc.querySelector("h1, h2, h3")?.textContent?.trim() ||
      doc.querySelector("title")?.textContent?.trim() ||
      `Chapter ${spineIndex + 1}`;

    chapters.push({
      spineIndex,
      id: item.id,
      href: item.href,
      title: chapterTitle,
      html: body.innerHTML,
      sentences,
    });
  }

  const toc = await parseToc({ zip, opfDoc, manifest, chapters });

  return { title, author, coverBlob, coverMediaType, toc, chapters };
}

async function resolveCover(
  zip: JSZip,
  opfDoc: Document,
  manifest: Map<string, ManifestItem>
): Promise<{ coverBlob: Blob | null; coverMediaType: string | null }> {
  let coverItem = Array.from(manifest.values()).find((m) =>
    m.properties?.split(/\s+/).includes("cover-image")
  );

  if (!coverItem) {
    const coverMeta = Array.from(opfDoc.getElementsByTagName("meta")).find(
      (m) => m.getAttribute("name") === "cover"
    );
    const coverId = coverMeta?.getAttribute("content");
    if (coverId) coverItem = manifest.get(coverId);
  }

  if (!coverItem) return { coverBlob: null, coverMediaType: null };

  const coverFile = zip.file(coverItem.href);
  if (!coverFile) return { coverBlob: null, coverMediaType: null };

  return {
    coverBlob: await coverFile.async("blob"),
    coverMediaType: coverItem.mediaType || "image/jpeg",
  };
}

interface TocParseArgs {
  zip: JSZip;
  opfDoc: Document;
  manifest: Map<string, ManifestItem>;
  chapters: EpubChapter[];
}

async function parseToc({ zip, opfDoc, manifest, chapters }: TocParseArgs): Promise<TocEntry[]> {
  const hrefToSpineIndex = new Map<string, number>();
  chapters.forEach((c) => hrefToSpineIndex.set(c.href, c.spineIndex));

  function lookupSpineIndex(path: string): number {
    const clean = stripFragment(path);
    if (hrefToSpineIndex.has(clean)) return hrefToSpineIndex.get(clean)!;
    const filename = clean.split("/").pop();
    const match = Array.from(hrefToSpineIndex.entries()).find(
      ([href]) => href.split("/").pop() === filename
    );
    return match ? match[1] : 0;
  }

  const navItem = Array.from(manifest.values()).find((m) =>
    m.properties?.split(/\s+/).includes("nav")
  );

  if (navItem) {
    const raw = await zip.file(navItem.href)?.async("string");
    if (raw) {
      const doc = new DOMParser().parseFromString(raw, "text/html");
      const navEl =
        Array.from(doc.querySelectorAll("nav")).find(
          (n) => n.getAttribute("epub:type") === "toc" || n.getAttribute("type") === "toc"
        ) ?? doc.querySelector("nav");
      const navDir = dirname(navItem.href);
      const topOl = navEl?.querySelector("ol");
      if (topOl) {
        const entries = parseNavList(topOl, navDir, lookupSpineIndex);
        if (entries.length) return entries;
      }
    }
  }

  const ncxId = opfDoc.getElementsByTagName("spine")[0]?.getAttribute("toc");
  const ncxItem = ncxId
    ? manifest.get(ncxId)
    : Array.from(manifest.values()).find((m) => m.mediaType === "application/x-dtbncx+xml");

  if (ncxItem) {
    const raw = await zip.file(ncxItem.href)?.async("string");
    if (raw) {
      const doc = new DOMParser().parseFromString(raw, "application/xml");
      const ncxDir = dirname(ncxItem.href);
      const navMap = doc.getElementsByTagName("navMap")[0];
      if (navMap) {
        const navPoints = Array.from(navMap.children).filter(
          (el) => el.tagName === "navPoint"
        );
        const entries = parseNavPoints(navPoints, ncxDir, lookupSpineIndex);
        if (entries.length) return entries;
      }
    }
  }

  return chapters.map((c) => ({ label: c.title, href: c.href, spineIndex: c.spineIndex }));
}

function parseNavList(
  ol: Element,
  baseDir: string,
  lookup: (path: string) => number
): TocEntry[] {
  const entries: TocEntry[] = [];

  Array.from(ol.children).forEach((li) => {
    if (li.tagName.toLowerCase() !== "li") return;
    const a = li.querySelector(":scope > a, :scope > span");
    const href = a?.getAttribute("href") ?? "";
    const label = a?.textContent?.trim() || "Untitled";
    const resolvedHref = href ? resolvePath(baseDir, href) : "";
    const childOl = li.querySelector(":scope > ol");
    const children = childOl ? parseNavList(childOl, baseDir, lookup) : undefined;

    entries.push({
      label,
      href: resolvedHref,
      spineIndex: href ? lookup(resolvedHref) : children?.[0]?.spineIndex ?? 0,
      children,
    });
  });

  return entries;
}

function parseNavPoints(
  navPoints: Element[],
  baseDir: string,
  lookup: (path: string) => number
): TocEntry[] {
  return navPoints.map((np) => {
    const label = np.getElementsByTagName("text")[0]?.textContent?.trim() || "Untitled";
    const src = np.getElementsByTagName("content")[0]?.getAttribute("src") || "";
    const resolvedHref = resolvePath(baseDir, src);
    const childPoints = Array.from(np.children).filter((el) => el.tagName === "navPoint");
    const children = childPoints.length
      ? parseNavPoints(childPoints, baseDir, lookup)
      : undefined;

    return {
      label,
      href: resolvedHref,
      spineIndex: lookup(resolvedHref),
      children,
    };
  });
}
