/**
 * Options → About: the "Appropriate Legal Notices" of AGPL §0/§5 (ADR 0006) — license, no
 * warranty, where the source is — plus the data and font licenses and what leaves the browser.
 */
import { browser } from 'wxt/browser';
import { t } from '@/src/i18n';

export const SOURCE_URL = 'https://github.com/Nexcod/phasa';
const LICENSE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';
const ATTRIBUTION_URL = `${SOURCE_URL}/blob/main/data/build/ATTRIBUTION.md`;
const PRIVACY_URL = `${SOURCE_URL}/blob/main/PRIVACY.md`;

function Link({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

export function About() {
  const version = browser.runtime.getManifest().version;
  return (
    <section id="about" className="page__section about" data-testid="phasa-options-about">
      <h2>{t('optionsSectionAbout')}</h2>
      <p>
        <strong>{t('aboutVersion', version)}</strong>
      </p>
      <p>{t('aboutLicense')}</p>
      <p className="about__links">
        <Link href={SOURCE_URL}>{t('aboutSource')}</Link>
        <Link href={LICENSE_URL}>{t('aboutLicenseLink')}</Link>
        <Link href={ATTRIBUTION_URL}>{t('aboutAttributionLink')}</Link>
        <Link href={PRIVACY_URL}>{t('aboutPrivacyLink')}</Link>
      </p>
      <p>{t('aboutData')}</p>
      <p>{t('aboutPrivacy')}</p>
      <p className="page__empty">{t('aboutNotAffiliated')}</p>
    </section>
  );
}
