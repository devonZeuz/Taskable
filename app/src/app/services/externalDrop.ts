export interface ExternalDropTaskData {
  title: string;
  description?: string;
}

export function hasExternalPayload(dataTransfer: DataTransfer): boolean {
  if (dataTransfer.files.length > 0) {
    return true;
  }

  const read = (type: string) => {
    try {
      return (dataTransfer.getData(type) ?? '').trim();
    } catch {
      return '';
    }
  };

  const plain = read('text/plain');
  const uriList = read('text/uri-list');
  const html = read('text/html');

  return plain.length > 0 || uriList.length > 0 || html.length > 0;
}

export function parseExternalDrop(dataTransfer: DataTransfer): ExternalDropTaskData | null {
  const fileTitle = parseFileTitle(dataTransfer.files);
  if (fileTitle) {
    return {
      title: fileTitle,
    };
  }

  const plain = (dataTransfer.getData('text/plain') ?? '').trim();
  const uriList = (dataTransfer.getData('text/uri-list') ?? '').trim();
  const html = (dataTransfer.getData('text/html') ?? '').trim();

  const mailtoFromUri = parseMailtoLine(uriList);
  if (mailtoFromUri) return mailtoFromUri;

  const mailtoFromPlain = parseMailtoLine(plain);
  if (mailtoFromPlain) return mailtoFromPlain;

  const subjectFromPlain = extractEmailSubjectLine(plain);
  if (subjectFromPlain) {
    return {
      title: clampTitle(subjectFromPlain),
      description: buildDescription(plain, subjectFromPlain),
    };
  }

  const candidateFromPlain = pickBestTitleCandidate(plain);
  if (candidateFromPlain) {
    return {
      title: clampTitle(candidateFromPlain),
      description: buildDescription(plain, candidateFromPlain),
    };
  }

  const htmlText = extractTextFromHtml(html);
  const candidateFromHtml = pickBestTitleCandidate(htmlText);
  if (candidateFromHtml) {
    return {
      title: clampTitle(candidateFromHtml),
      description: buildDescription(htmlText, candidateFromHtml),
    };
  }

  const candidateFromUri = pickBestTitleCandidate(uriList);
  if (candidateFromUri) {
    return {
      title: clampTitle(candidateFromUri),
    };
  }

  return null;
}

function parseFileTitle(files: FileList): string | null {
  if (files.length === 0) return null;
  const first = files[0]?.name?.trim();
  if (!first) return null;
  const withoutExt = first.replace(/\.[a-z0-9]+$/i, '');
  return clampTitle(withoutExt);
}

function parseMailtoLine(value: string): ExternalDropTaskData | null {
  const trimmed = value.trim();
  if (!trimmed.toLowerCase().startsWith('mailto:')) return null;

  const raw = trimmed.slice('mailto:'.length);
  const [recipientPart, queryPart] = raw.split('?');
  const recipient = decodeURIComponent((recipientPart ?? '').replace(/\s+/g, ''));
  const params = new URLSearchParams(queryPart ?? '');
  const subject = params.get('subject')?.trim();
  const body = params.get('body')?.trim();

  if (subject) {
    return {
      title: clampTitle(subject),
      description: body ? body.slice(0, 320) : recipient ? `From: ${recipient}` : undefined,
    };
  }

  if (recipient) {
    return { title: clampTitle(recipient), description: body ? body.slice(0, 320) : undefined };
  }

  return null;
}

function extractEmailSubjectLine(text: string): string | null {
  const lines = splitLines(text);
  const subjectLine = lines.find((line) => /^subject\s*:/i.test(line));
  if (!subjectLine) return null;
  const value = subjectLine.replace(/^subject\s*:/i, '').trim();
  return value || null;
}

function pickBestTitleCandidate(text: string): string | null {
  const lines = splitLines(text);
  if (lines.length === 0) return null;

  const filtered = lines.filter((line) => !isMetadataLine(line));
  if (filtered.length === 0) return null;

  // Outlook drag payload often begins with "Microsoft Outlook", then subject line.
  if (/^microsoft outlook$/i.test(lines[0]) && filtered.length > 0) {
    return filtered[0];
  }

  return filtered[0];
}

function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0);
}

function isMetadataLine(line: string): boolean {
  const normalized = line.toLowerCase();
  if (
    normalized === 'microsoft outlook' ||
    normalized.startsWith('this is an email message') ||
    normalized.startsWith('from:') ||
    normalized.startsWith('to:') ||
    normalized.startsWith('cc:') ||
    normalized.startsWith('bcc:') ||
    normalized.startsWith('date:') ||
    normalized.startsWith('sent:') ||
    normalized.startsWith('received:')
  ) {
    return true;
  }

  if (/^\d{1,2}:\d{2}(\s?[ap]m)?$/i.test(normalized)) {
    return true;
  }

  if (/^https?:\/\//i.test(normalized)) {
    return true;
  }

  return false;
}

function extractTextFromHtml(html: string): string {
  if (!html) return '';
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return (doc.body?.textContent ?? '').replace(/\s+\n/g, '\n').trim();
  } catch {
    return '';
  }
}

function clampTitle(title: string): string {
  return title.trim().slice(0, 120) || 'New Inbox Task';
}

function buildDescription(source: string, usedTitle: string): string | undefined {
  const normalized = source.trim();
  if (!normalized) return undefined;
  if (normalized === usedTitle) return undefined;
  return normalized.slice(0, 320);
}
