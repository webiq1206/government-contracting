import { scryptSync, randomBytes } from "node:crypto";
import pg from "pg";

const { Pool } = pg;

const TEST_EMAIL = "testoperator@brostco.dev";
const TEST_PASSWORD = "testpass123";

export const TEST_OPP_ID = "05c90f41-c69e-4fbc-95b8-646d70d016be";
export const TEST_SUB_HVAC_ID = "bfb77975-c12d-40eb-ab3f-6a096ee67b79";
export const TEST_SUB_ELEC_ID = "921da645-40b1-458f-af08-cad5977910b2";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export default async function globalSetup() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    await pool.query(
      `INSERT INTO users (id, email, password_hash, name, role)
       VALUES (gen_random_uuid(), $1, $2, 'Test Operator', 'operator')
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [TEST_EMAIL, hashPassword(TEST_PASSWORD)]
    );

    await pool.query(
      `DELETE FROM call_cards WHERE opportunity_id = $1 AND subcontractor_id = $2`,
      [TEST_OPP_ID, TEST_SUB_HVAC_ID]
    );

    await pool.query(
      `INSERT INTO call_cards
         (opportunity_id, subcontractor_id, status, card_json, question_list, needs_project_history)
       VALUES ($1, $2, 'pending', '{}', '{}', false)`,
      [TEST_OPP_ID, TEST_SUB_HVAC_ID]
    );

    await pool.query(
      `DELETE FROM call_cards WHERE opportunity_id = $1 AND subcontractor_id = $2`,
      [TEST_OPP_ID, TEST_SUB_ELEC_ID]
    );

    await pool.query(
      `INSERT INTO call_cards
         (opportunity_id, subcontractor_id, status, card_json, question_list,
          needs_project_history, quote_amount, response_json)
       VALUES ($1, $2, 'called', '{}', '{}', false, NULL, '{"outcome":"interested"}'::jsonb)`,
      [TEST_OPP_ID, TEST_SUB_ELEC_ID]
    );
  } finally {
    await pool.end();
  }
}
