/**
 * Favicon Synchronization
 * Dynamically updates the favicon based on the store logo
 */

import { useEffect } from "react";
import { useStoreLogo } from "@/lib/store-logo";

/**
 * Hook to synchronize favicon with the store logo
 * Call this in a root layout component to keep favicon in sync
 */
export function useFaviconSync() {
  const logoUrl = useStoreLogo();

  useEffect(() => {
    // If we have a logo URL, create a favicon from it
    if (logoUrl && typeof document !== "undefined") {
      // Update the favicon link element
      let faviconLink = document.querySelector(
        'link[rel="icon"]'
      ) as HTMLLinkElement;

      if (!faviconLink) {
        faviconLink = document.createElement("link");
        faviconLink.rel = "icon";
        document.head.appendChild(faviconLink);
      }

      // Set the href to the logo URL
      faviconLink.href = logoUrl;

      // Also try to update as apple-touch-icon for better mobile support
      let appleTouchIcon = document.querySelector(
        'link[rel="apple-touch-icon"]'
      ) as HTMLLinkElement;

      if (!appleTouchIcon && logoUrl) {
        appleTouchIcon = document.createElement("link");
        appleTouchIcon.rel = "apple-touch-icon";
        document.head.appendChild(appleTouchIcon);
      }

      if (appleTouchIcon && logoUrl) {
        appleTouchIcon.href = logoUrl;
      }
    }
  }, [logoUrl]);
}
