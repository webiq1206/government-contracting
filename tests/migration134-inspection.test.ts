import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { assert134Ledger, fingerprint, inspectMigration134, validateInspectionScope, validateRateSchema } from "../scripts/lib/migration134-inspection";

const columns = [
  ...["provider", "service", "evidence"].map(column_name => ({ table_name:"api_usage_rates", column_name, data_type:"text", is_nullable:"NO", column_default:null })),
  {table_name:"api_usage_rates",column_name:"rates",data_type:"jsonb",is_nullable:"NO",column_default:null},
  {table_name:"api_usage_rates",column_name:"max_request_cost",data_type:"numeric",is_nullable:"YES",column_default:null,numeric_precision:24,numeric_scale:12},
  {table_name:"api_usage_rates",column_name:"updated_at",data_type:"timestamp with time zone",is_nullable:"NO",column_default:"now()"},
  ...["name","checksum"].map(column_name => ({table_name:"_migrations",column_name,data_type:"text",is_nullable:"NO",column_default:null})),
  {table_name:"_migrations",column_name:"applied_at",data_type:"timestamp with time zone",is_nullable:"NO",column_default:"now()"},
];
const constraints = [
  {table_name:"api_usage_rates",kind:"p",definition:"PRIMARY KEY (provider, service)",deferred:false},
  {table_name:"api_usage_rates",kind:"c",definition:"CHECK ((max_request_cost >= (0)::numeric))",deferred:false},
  {table_name:"_migrations",kind:"p",definition:"PRIMARY KEY (name)",deferred:false},
];
const relations = [
  {table_name:"api_usage_rates",kind:"r",rls:true,force_rls:false},
  {table_name:"_migrations",kind:"r",rls:false,force_rls:false},
];

describe("owner-only migration134 read-only inspection", () => {
  it("preserves legacy inspect/apply defaults", () => {
    expect(validateInspectionScope("apply")).toBe("ledger");
    expect(validateInspectionScope("inspect", "migration134")).toBe("migration134");
  });
  it("cannot turn evidence mode into a production write", () => {
    expect(() => validateInspectionScope("apply", "migration134")).toThrow("read-only");
    expect(() => validateInspectionScope("inspect", "anything-else")).toThrow("Unknown");
  });
  it("refuses other pending files, mismatched files and unverifiable historical ledger rows", () => {
    expect(() => assert134Ledger(["135_other.sql"],[],["abc"])).toThrow("other pending");
    expect(() => assert134Ledger([], ["old.sql"], ["abc"])).toThrow("ledger drift");
    expect(() => assert134Ledger([], [], [null])).toThrow("historical");
    expect(() => assert134Ledger(["134_gpt6_candidate_rates.sql"], [], ["orphan:migration-file-removed-from-repo"])).not.toThrow();
  });
  it("refuses a writable or nonrepeatable snapshot before reading production rows", async () => {
    const migration = readFileSync("db/migrations/134_gpt6_candidate_rates.sql");
    for (const state of [{readonly:"off",isolation:"repeatable read",timezone:"UTC"},{readonly:"on",isolation:"read committed",timezone:"UTC"}]) {
      let calls = 0;
      const query = async () => { calls++; return {rows:[state]}; };
      await expect(inspectMigration134({query} as never,migration)).rejects.toThrow("READ ONLY");
      expect(calls).toBe(1);
    }
  });
  it("accepts the reviewed affected-table contract", () => {
    expect(() => validateRateSchema(columns,constraints,relations,[],[])).not.toThrow();
  });
  it.each(["trigger","rule"])("refuses unexpected %s execution", kind => {
    expect(() => validateRateSchema(columns,constraints,relations,kind==="trigger"?[{}]:[],kind==="rule"?[{}]:[])).toThrow("trigger/rule");
  });
  it("refuses disabled RLS or a deferred conflict key", () => {
    expect(() => validateRateSchema(columns,constraints,[{...relations[0],rls:false},relations[1]],[],[])).toThrow("RLS");
    expect(() => validateRateSchema(columns,[{...constraints[0],deferred:true},...constraints.slice(1)],relations,[],[])).toThrow("constraint");
  });
  it("refuses unknown columns/defaults and nullable historical checksums", () => {
    expect(() => validateRateSchema([...columns,{...columns[0],column_name:"surprise"}],constraints,relations,[],[])).toThrow("column");
    expect(() => validateRateSchema(columns.map(c=>c.column_name==="checksum"?{...c,is_nullable:"YES"}:c),constraints,relations,[],[])).toThrow("column");
    expect(() => validateRateSchema(columns.map(c=>c.column_name==="rates"?{...c,column_default:"custom_function()"}:c),constraints,relations,[],[])).toThrow("default");
    expect(() => validateRateSchema(columns.map(c=>c.column_name==="max_request_cost"?{...c,numeric_scale:2}:c),constraints,relations,[],[])).toThrow("precision");
  });
  it("fingerprints distinguish absence, exact decimals, nulls and microseconds without returning rows", () => {
    const row = '{"value":"3.000000000001","at":"2026-10-14 18:00:00.123456+00","other":null}';
    expect(fingerprint([{row}])).toEqual(fingerprint([{row}]));
    expect(fingerprint([{row}]).sha256).not.toBe(fingerprint([{row:row.replace("123456","123457")}]).sha256);
    expect(fingerprint([{row}]).sha256).not.toBe(fingerprint([{row:row.replace("000001","000000")}]).sha256);
    expect(fingerprint([]).count).toBe(0);
    expect(Object.keys(fingerprint([{row}]))).toEqual(["count","sha256"]);
  });
  it("rejects a changed migration before touching the database", async () => {
    const query = () => { throw new Error("must not query"); };
    await expect(inspectMigration134({query} as never,Buffer.from("modified SQL"))).rejects.toThrow("source hash");
  });
});
