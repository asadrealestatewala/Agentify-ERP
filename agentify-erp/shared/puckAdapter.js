/**
 * Website pages <-> the Puck visual editor's data, without changing how pages are stored.
 *
 * A page section is  { id, type, props, style? }  (site_pages.sections, SECTION_TYPES in client/src/site/siteCore.jsx).
 * Puck holds         { type, props: { id, ...props } }  in data.content.
 * The section's own id and responsive style ride along in reserved props (id, __style), and anything else a stored
 * section carries is kept in __extra, so fromPuck(toPuck(sections)) gives back exactly what was stored.
 */
const RESERVED = ['id', '__style', '__extra', '__numId', '__noProps'];

export function toPuck(sections, root = {}) {
  return {
    root: { props: { ...root } },
    content: (sections || []).map((s) => {
      const { id, type, props, style, ...extra } = s;
      const p = { ...(props || {}), id: String(id) };
      if (typeof id === 'number') p.__numId = true;
      if (props === undefined) p.__noProps = true;
      if (style !== undefined) p.__style = style;
      if (Object.keys(extra).length) p.__extra = extra;
      return { type, props: p };
    }),
  };
}

export function fromPuck(data) {
  return (data?.content || []).map((c) => {
    const { id, __style, __extra, __numId, __noProps, ...props } = c.props || {};
    const s = { ...(__extra || {}), id: __numId ? Number(id) : id, type: c.type };
    if (!__noProps || Object.keys(props).length) s.props = props;
    if (__style !== undefined) s.style = __style;
    return s;
  });
}

export const RESERVED_PROPS = RESERVED;
