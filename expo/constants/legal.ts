/**
 * Legal documents shown at sign-up and in the app.
 *
 * These are placeholder texts. When the final legal copy is provided, replace
 * the `body` strings below and bump the matching `VERSION` — every user who
 * accepts afterwards is recorded against the new version, and the app can
 * prompt for re-acceptance if you gate on it.
 *
 * `doc_type` values must match the migration: 'terms' | 'nda' | 'privacy'.
 */

export const TERMS_VERSION = '1.0';
export const NDA_VERSION = '1.0';

export interface LegalDoc {
  key: 'terms' | 'nda' | 'privacy';
  title: string;
  version: string;
  /** Short one-liner shown next to the acceptance checkbox. */
  summary: string;
  body: string;
}

export const TERMS_AND_CONDITIONS: LegalDoc = {
  key: 'terms',
  title: 'Terms & Conditions',
  version: TERMS_VERSION,
  summary: 'I agree to the Dock2Door Terms & Conditions and Privacy Policy.',
  body: `Dock2Door — Terms & Conditions
Last updated: 2026

Welcome to Dock2Door. These Terms & Conditions ("Terms") govern your access to and use of the Dock2Door platform, applications and services (together, the "Service"). By creating an account or using the Service, you agree to these Terms.

1. Your account
You must provide accurate, current and complete information when you register, and keep it up to date. You are responsible for all activity that happens under your account and for keeping your login credentials secure. You must be legally able to enter into these Terms in your jurisdiction.

2. The marketplace
Dock2Door connects customers, warehouses, service providers, employers, workers, carriers, drivers, drayage companies and freight forwarders. Dock2Door provides the platform that enables these connections; unless expressly stated, Dock2Door is not a party to the agreements made between users and does not itself provide warehousing, transportation or labour services.

3. Acceptable use
You agree not to misuse the Service, including by: breaking any law or regulation; posting false, misleading or fraudulent information; infringing anyone's rights; attempting to gain unauthorised access to the Service or other accounts; or interfering with the normal operation of the platform.

4. Bookings, jobs and payments
When you book, accept or fulfil work through the Service, you agree to the price, scope and terms shown at the time. Fees, commissions and payouts are handled as described in the Service. You are responsible for any taxes that apply to you.

5. Content and data
You retain ownership of the content you submit, and you grant Dock2Door a licence to host and display it as needed to operate the Service. You are responsible for the accuracy and legality of everything you submit.

6. Suspension and termination
We may suspend or close accounts that breach these Terms, create risk, or harm other users or the platform. You may stop using the Service at any time.

7. Disclaimers and liability
The Service is provided "as is". To the maximum extent permitted by law, Dock2Door is not liable for indirect or consequential losses, or for the acts of other users. Nothing in these Terms limits liability that cannot be limited by law.

8. Changes
We may update these Terms. If we make material changes we will let you know, and continued use of the Service means you accept the updated Terms.

9. Contact
Questions about these Terms can be sent to Dock2Door support through the app.

By ticking "I agree", you confirm that you have read, understood and accept these Terms & Conditions and the Privacy Policy.`,
};

export const SALES_AGENT_NDA: LegalDoc = {
  key: 'nda',
  title: 'Sales Agent Non-Disclosure Agreement',
  version: NDA_VERSION,
  summary: 'I have read and agree to be bound by the Sales Agent Non-Disclosure Agreement.',
  body: `Dock2Door — Sales Agent Non-Disclosure Agreement (NDA)
Last updated: 2026

This Non-Disclosure Agreement ("Agreement") is entered into between Dock2Door ("Company") and you, the individual registering as a Sales Agent ("Agent"), as of the date you accept it electronically.

1. Purpose
As a Sales Agent you will be given access to confidential information in order to introduce, onboard and support businesses and individuals on the Dock2Door platform. This Agreement protects that information.

2. Confidential information
"Confidential Information" means any non-public information disclosed to or accessed by the Agent in connection with the Company, including but not limited to: customer, lead and prospect lists and contact details; pricing, commission structures and financial data; business plans and strategy; product and technical information; and any information marked or reasonably understood to be confidential.

3. Agent obligations
The Agent agrees to: (a) keep all Confidential Information strictly confidential; (b) use it only to perform their role for the Company; (c) not disclose it to any third party without the Company's prior written consent; (d) not use it for personal gain or to compete with the Company; and (e) protect it with at least reasonable care.

4. Leads and customers belong to the Company
All leads, prospects, customers and accounts generated, accessed or onboarded through the platform are the property of the Company. The Agent will not solicit, divert or take those relationships outside the platform, during the engagement or after it ends.

5. Non-solicitation and non-circumvention
During the engagement and for 12 months after it ends, the Agent will not circumvent the Company to transact directly with any lead, customer or partner introduced through the platform, nor solicit Company staff or other agents to leave.

6. Return of information
On request or when the engagement ends, the Agent will stop using and will delete or return all Confidential Information in their possession.

7. Term
The confidentiality obligations in this Agreement survive the end of the Agent's engagement and remain in effect for as long as the information stays confidential.

8. No employment
This Agreement does not create an employment relationship. It governs confidentiality only and is separate from any commission or engagement terms.

9. Remedies
The Agent agrees that a breach may cause the Company irreparable harm for which money alone is not an adequate remedy, and that the Company may seek injunctive relief in addition to any other remedy.

10. Electronic signature
By typing your full legal name and accepting below, you agree that your electronic signature is legally binding and has the same effect as a handwritten signature on this Agreement.`,
};

export const ALL_LEGAL_DOCS: LegalDoc[] = [TERMS_AND_CONDITIONS, SALES_AGENT_NDA];
