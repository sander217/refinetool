import type {
  ChangelogEntry,
  RefinementArtifact,
  RefinementItem,
} from '../../shared/types';

// Build a RefinementArtifact from a RefinementItem. Artifacts are derived,
// not persisted — changing this function updates every downstream prompt +
// the "Copy artifact JSON" output at once.
export function buildArtifact(item: RefinementItem): RefinementArtifact {
  return {
    schemaVersion: '1',
    id: item.id,
    createdAt: item.createdAt,
    page: {
      url: item.pageUrl,
      title: item.pageTitle,
    },
    region: {
      label: item.target.label,
      selector: item.target.selector,
      tag: item.target.tag,
      breadcrumb: item.target.breadcrumb ?? [],
      boundingBox: item.target.boundingBox,
      snippet: item.target.snippet,
      hasImage: item.target.hasImage,
    },
    intent: {
      currentIssue: item.parsed.currentIssue,
      requestedChange: item.parsed.requestedChange,
      designIntent: item.parsed.designIntent,
      implementationNotes: item.parsed.implementationNotes ?? [],
    },
    constraints: {
      preserve: item.parsed.preserve ?? [],
      doNotTouch: item.parsed.doNotTouch ?? [],
      other: item.parsed.constraints ?? [],
    },
    diffs: item.diffs,
    userNote: {
      raw: item.rawInput,
      transcript: item.transcript,
      inputMode: item.inputMode,
    },
    changelog: item.changelog ?? [],
  };
}

export function serializeArtifact(artifact: RefinementArtifact): string {
  // Strip large inline payloads (data URLs) before serializing so prompt
  // / clipboard output stays readable.
  const sanitized: RefinementArtifact = {
    ...artifact,
    diffs: artifact.diffs.map((diff) => {
      if (diff.type === 'image_replace_intent' && diff.dataUrl) {
        return { ...diff, dataUrl: '(inline data URI stripped for export)' };
      }
      return diff;
    }),
  };
  return JSON.stringify(sanitized, null, 2);
}

export function appendChangelog(
  existing: ChangelogEntry[] | undefined,
  entry: ChangelogEntry,
): ChangelogEntry[] {
  const list = existing ?? [];
  const next = [...list, entry];
  // Cap growth so the item payload doesn't balloon forever.
  if (next.length > 50) return next.slice(next.length - 50);
  return next;
}
