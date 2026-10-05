import type { CoreBundle, FileMap } from './deckfs';
import YAML from 'yaml';
import type { TemplateSource } from './types';

const raw = import.meta.glob('../../../core-templates/**/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

function bundle(): CoreBundle {
  const files: FileMap = new Map(Object.entries(raw).map(([k, v]) => [k.replace(/^.*core-templates\//, ''), v]));
  const ids = [...files.keys()].map((p) => /^([^/]+)\/view\.njk$/.exec(p)?.[1]).filter((id): id is string => Boolean(id)).sort();
  const templates: TemplateSource[] = ids.map((id) => ({
    id, scope: 'core',
    manifest: YAML.parse(files.get(`${id}/manifest.yaml`) ?? '') ?? { id },
    view: files.get(`${id}/view.njk`) ?? '',
    style: files.get(`${id}/style.css`) ?? '',
    logic: files.get(`${id}/logic.js`) ?? null,
  }));
  return { templates, partials: { 'core/_macros': files.get('_macros.njk') ?? '' }, baseCss: files.get('_base.css') ?? '' };
}

export const CORE: CoreBundle = bundle();
