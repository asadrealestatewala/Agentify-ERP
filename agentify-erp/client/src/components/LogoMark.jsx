// The Agentify mark: teal rounded tile with a white house (same geometry as the favicon in index.html).
export default function LogoMark({ size = 28, tile = true, className, title }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 32 32" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false">
      {tile && <rect width="32" height="32" rx="7" fill="#0e7c6b" />}
      <path d="M7 24V13l9-6 9 6v11h-6v-7h-6v7z" fill={tile ? '#fff' : 'currentColor'} />
    </svg>
  );
}
