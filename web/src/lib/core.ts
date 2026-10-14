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
  // Shared pieces (_macros.njk, _clip.njk) are imported as core/_<name>.
  const partials = Object.fromEntries([...files].filter(([p]) => /^_[\w-]+\.njk$/.test(p)).map(([p, src]) => [`core/${p.slice(0, -4)}`, src]));
  return { templates, partials, baseCss: files.get('_base.css') ?? '' };
}

export const CORE: CoreBundle = bundle();
