import YAML from 'yaml';

export function splitFrontmatter(text: string): { meta: any; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!match) return { meta: {}, body: text };
  return { meta: YAML.parse(match[1]) ?? {}, body: match[2] };
}

function compactProgress(doc: YAML.Document, progress: any) {
  const node = doc.createNode(progress) as YAML.YAMLMap;
  for (const key of ['skills', 'exercises']) {
    const map = node.get(key) as YAML.YAMLMap | undefined;
    map?.items.forEach((item) => { (item.value as YAML.YAMLMap).flow = true; });
  }
  const totals = node.get('totals') as YAML.YAMLMap | undefined;
  if (totals) totals.flow = true;
  return node;
}

export function withProgress(cardYaml: string, progress: any): string {
  const doc = YAML.parseDocument(cardYaml);
  doc.set('progress', compactProgress(doc, progress));
  return doc.toString({ lineWidth: 0 });
}

export function readProgress(cardYaml: string): any {
  return YAML.parse(cardYaml)?.progress ?? null;
}

export interface ExercisePatch { status?: string; params?: Record<string, unknown> }

export function patchCardExercise(cardYaml: string, exerciseId: string, patch: ExercisePatch): string {
  const doc = YAML.parseDocument(cardYaml);
  const list = doc.get('exercises') as YAML.YAMLSeq<YAML.YAMLMap>;
  const item = list?.items.find((ex) => ex.get('id') === exerciseId);
  if (!item) throw new Error(`exercise ${exerciseId} not found`);
  if (patch.status) item.set('status', patch.status);
  if (patch.params) item.set('params', doc.createNode(patch.params));
  return doc.toString({ lineWidth: 0 });
}

export function patchMdExercise(text: string, patch: ExercisePatch): string {
  const { meta, body } = splitFrontmatter(text);
  if (patch.status) meta.status = patch.status;
  const markdown = (patch.params?.markdown as string | undefined) ?? body;
  return `---\n${YAML.stringify(meta).trim()}\n---\n${markdown}`;
}
