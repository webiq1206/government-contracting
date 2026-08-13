-- The W-9 itself: the fields a subcontractor fills in and signs.
--
-- 040 gave every compliance document a place to live and an expiry to act on.
-- It did not give the W-9 anywhere to put its contents, because until now a
-- W-9 arrived as a PDF somebody had already signed. Collecting the signature
-- here means collecting the form data here too.
--
-- The taxpayer identification number is the reason this migration is careful.
-- A TIN is an SSN for most sole proprietors, so the table now holds the single
-- most sensitive field in the platform. Three rules follow from that:
--
--   1. The number is stored AES-256-GCM encrypted, never in plaintext, using
--      the same key derivation as integration credentials.
--   2. The last four digits are stored separately in the clear, because every
--      screen that needs to show a TIN only ever needs those four. Nothing in
--      the UI decrypts the full number.
--   3. Decryption belongs to 1099 filing, and to nothing else.
--
-- Storing the last four separately is not a duplicate of the encrypted value:
-- it is what makes the encrypted value readable-never rather than
-- readable-often, which is the whole point.

alter table subcontractor_documents
  -- Line 1 on the form: the name on the sub's income tax return. Not always
  -- the company name we know them by, which is why both are captured.
  add column if not exists w9_legal_name        text,
  -- Line 2: DBA / trade name, when it differs from line 1.
  add column if not exists w9_business_name     text,
  -- Line 3a: sole_proprietor | c_corp | s_corp | partnership | trust_estate
  --          | llc | other
  add column if not exists w9_tax_classification text,
  -- Line 3a, LLC only: the tax classification the LLC elected (C, S, or P).
  -- An LLC row without this is incomplete, which the form validation enforces.
  add column if not exists w9_llc_tax_class     text,
  -- Line 4. Rare on subcontractor work, but the form has them and a sub who
  -- needs one will not have anywhere else to put it.
  add column if not exists w9_exempt_payee_code text,
  add column if not exists w9_fatca_code        text,
  -- Lines 5 and 6: the address the 1099 gets mailed to. Deliberately separate
  -- from the subcontractors table's address, which is where crews work out of
  -- and is frequently not where mail goes.
  add column if not exists w9_address           text,
  add column if not exists w9_city              text,
  add column if not exists w9_state             text,
  add column if not exists w9_zip               text,
  -- Part I. ssn | ein
  add column if not exists w9_tin_type          text,
  -- The only part of the TIN any screen may read.
  add column if not exists w9_tin_last4         text,
  -- v1:<iv>:<tag>:<ciphertext>, AES-256-GCM. See lib/domain/w9-crypto.ts.
  add column if not exists w9_tin_encrypted     text,
  -- Which wording of the perjury certification the signer agreed to. The IRS
  -- revises the form; a signature is only defensible if we can still produce
  -- the exact text that was on screen years later.
  add column if not exists w9_certification_version text,
  -- 'subcontractor' when signed or uploaded through the portal, 'operator'
  -- when staff put it on file by hand.
  --
  -- A W-9 SIGNED in the platform is always 'subcontractor': recordSignedW9
  -- hardcodes it, because only the taxpayer can certify their own TIN under
  -- penalty of perjury. A W-9 UPLOADED as 'operator' is still legitimate, and
  -- is the normal case for a scanned paper form the sub already signed: staff
  -- filed the paper, the sub certified it. Verification is what distinguishes
  -- the two, which is why an upload lands as pending either way.
  add column if not exists source               text not null default 'operator';

-- Never let a plaintext TIN reach the query log or an index.
create index if not exists sub_documents_w9_idx
  on subcontractor_documents (subcontractor_id)
  where doc_type = 'w9';
