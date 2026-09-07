import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync("lib/contract-record.ts", "utf8");

function body(start: string, end?: string): string {
  const from = SOURCE.indexOf(start);
  const to = end ? SOURCE.indexOf(end, from + start.length) : SOURCE.length;
  return SOURCE.slice(from, to);
}

describe("contract record tenant and partial-write safety", () => {
  it("only exposes related records that share the contract organization", () => {
    const read = body(
      "export async function contractRecord",
      "async function ownsContract",
    );

    expect(read).toContain("o.id as opportunity_id");
    expect(read).toContain("o.org_id = c.org_id");
    expect(read).toContain("ps.id as primary_sub_id");
    expect(read).toContain("ps.org_id = c.org_id");
    expect(read).toContain("bs.id as backup_sub_id");
    expect(read).toContain("bs.org_id = c.org_id");
    expect(read).toContain("b.org_id = c.org_id");
    expect(read).toContain("organization_members cm");
    expect(read).toContain("cm.org_id = c.org_id");
    expect(read).toContain("left join users au on au.id = cm.user_id");
    expect(read).not.toContain("c.created_manually, c.opportunity_id");
    expect(read).not.toContain("c.primary_sub_id, ps.company_name");
    expect(read).not.toContain("c.assigned_to,");
  });

  it("creates every startup obligation in one transaction and never swallows an insert", () => {
    const seed = body("export async function seedContractStartup");

    expect(seed).toContain("return transaction(async (client)");
    expect(seed).toContain("from contracts where id = $1 and org_id = $2");
    expect(seed).toContain("for update");
    expect(seed).toContain("throw new ContractRefusal");
    expect(seed).toContain("await client.query<{ id: string }>");
    expect(seed).not.toContain(".catch(");
    expect(seed).not.toContain("return { milestones: 0, compliance: 0 }");
  });

  it("validates every optional relationship before writing it", () => {
    const modification = body(
      "export async function saveModification",
      "export async function saveInvoice",
    );
    const coordination = body(
      "export async function logCoordination",
      "export async function updateContractTerms",
    );
    const create = body(
      "export async function createContract",
      "export { ownsContract }",
    );

    expect(modification).toContain(
      "where id = $3 and contract_id = $1 and org_id = $2",
    );
    expect(
      modification.indexOf("const prior = await client.query"),
    ).toBeLessThan(modification.indexOf("insert into contract_modifications"));
    expect(coordination).toContain(
      "select id from subcontractors where id = $1 and org_id = $2 for key share",
    );
    expect(coordination).not.toContain("(select s.id from subcontractors");
    expect(create).toContain(
      "select id from opportunities where id = $1 and org_id = $2 for key share",
    );
    expect(create).not.toContain("(select o.id from opportunities");
  });
});
