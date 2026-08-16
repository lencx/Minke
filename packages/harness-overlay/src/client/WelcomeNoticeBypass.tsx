import { useEffect } from "react";

export interface WelcomeNoticeBypassProps {
  complete(): void;
}

/**
 * Complete Harness's internal-testing onboarding cell without painting it.
 * Minke is a product shell, so upstream developer notices must not interrupt
 * each fresh desktop profile or return when Harness bumps its notice version.
 */
export function WelcomeNoticeBypass({
  complete,
}: WelcomeNoticeBypassProps): null {
  useEffect(() => {
    complete();
  }, [complete]);
  return null;
}
