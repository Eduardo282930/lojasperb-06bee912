/**
 * Store Logo Component
 * Displays the store logo from the centralized source (system_products table)
 * Can be used in headers, footers, and other locations
 */

import { useStoreLogo } from "@/lib/store-logo";

interface StoreLogoProps {
  className?: string;
  alt?: string;
  fallback?: React.ReactNode;
}

export function StoreLogo({
  className = "h-12 w-auto",
  alt = "Logo da Loja",
  fallback = null,
}: StoreLogoProps) {
  const logoUrl = useStoreLogo();

  if (!logoUrl) {
    return fallback;
  }

  return (
    <img
      src={logoUrl}
      alt={alt}
      className={className}
      loading="eager"
      fetchPriority="high"
      decoding="async"
    />
  );
}

/**
 * Store Logo with fallback text
 * Displays the logo or returns the store name if no logo is available
 */
export function StoreLogoWithFallback({
  storeName = "SPERB",
  className = "h-12 w-auto",
  fallbackClassName = "text-lg font-bold",
}: {
  storeName?: string;
  className?: string;
  fallbackClassName?: string;
}) {
  const logoUrl = useStoreLogo();

  if (!logoUrl) {
    return <span className={fallbackClassName}>{storeName}</span>;
  }

  return (
    <img
      src={logoUrl}
      alt={storeName}
      className={className}
      loading="eager"
      fetchPriority="high"
      decoding="async"
    />
  );
}

/**
 * Store Logo - Admin Version with management capability
 * Shows the logo with options to manage it (admin only)
 */
export function StoreLogoAdmin({
  className = "h-12 w-auto",
}: {
  className?: string;
}) {
  const logoUrl = useStoreLogo();

  if (!logoUrl) {
    return (
      <div className={`${className} flex items-center justify-center rounded bg-muted text-muted-foreground`}>
        Sem logo
      </div>
    );
  }

  return (
    <img
      src={logoUrl}
      alt="Logo da Loja"
      className={className}
      loading="eager"
      fetchPriority="high"
      decoding="async"
    />
  );
}
