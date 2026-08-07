/**
 * Site-wide click-to-contact links. Phones become tel: links and emails become
 * mailto: links everywhere they appear, so a tap on any device starts the call
 * or opens the email. Plain (non-client) components: they render as anchors.
 */

export function PhoneLink({
  phone,
  className,
  fallback = "-",
}: {
  phone?: string | null;
  className?: string;
  fallback?: React.ReactNode;
}) {
  if (!phone) return <span className="text-slate-500">{fallback}</span>;
  const tel = phone.replace(/[^\d+]/g, "");
  return (
    <a href={`tel:${tel}`} className={className ?? "text-accent hover:underline"}>
      {phone}
    </a>
  );
}

export function EmailLink({
  email,
  className,
  fallback = "-",
}: {
  email?: string | null;
  className?: string;
  fallback?: React.ReactNode;
}) {
  if (!email) return <span className="text-slate-500">{fallback}</span>;
  return (
    <a href={`mailto:${email}`} className={className ?? "text-accent hover:underline"}>
      {email}
    </a>
  );
}
