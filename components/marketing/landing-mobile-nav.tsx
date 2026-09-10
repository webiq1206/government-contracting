import { MarketingMobileMenu } from "./mobile-menu";

export function LandingMobileNav({ signupHref, loginHref }: { signupHref: string; loginHref: string }) {
  return <div className="mobile-nav"><MarketingMobileMenu signupHref={signupHref} loginHref={loginHref} onLanding dark /></div>;
}
