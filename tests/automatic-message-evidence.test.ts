import { describe, expect, it } from "vitest";
import { isAutomatic, isGenuineReply, automaticMessageSql, AUTOMATIC_SUBJECT_SQL } from "@/lib/domain/message-state";
import { PGlite } from "@electric-sql/pglite";

const base = { direction: "inbound", delivery_state: null, delivery_detail: null,
  opened_at: null, clicked_at: null, replied_at: null, subject: "Re: outreach" };

describe("automatic response evidence", () => {
  it("does not count a plain-subject out-of-office notice as a substantive reply", () => {
    const row = { ...base, body: "I am currently out of the office, but I will return on Wednesday. If the matter cannot wait, please contact the office." };
    expect(isAutomatic(row)).toBe(true);
    expect(isGenuineReply(row)).toBe(false);
  });
  it.each([
    "We are interested. I am currently out of the office, but will return Wednesday.",
    "I am currently out of the office. Our quote is attached.",
    "Our price is 550 per square, delivery in three weeks.",
    "Please see the attached quote.\n> I am currently out of the office.",
  ])("keeps substantive content and quoted history eligible for review: %s", (body) => {
    expect(isAutomatic({ ...base, body })).toBe(false);
  });
  it("keeps SQL counts aligned with explicit flags, plain-subject absence and genuine replies", async () => {
    const db = new PGlite();
    try {
      await db.exec("create table messages(id int,subject text,body text,meta jsonb)");
      await db.query(`insert into messages values
        (1,'Re: outreach','I am currently out of the office, but I will return Wednesday.',null),
        (2,'Re: quote','Automatic acknowledgment','{"auto":true}'),
        (3,'Re: quote','Our quote is attached.',null),
        (4,'Re: quote','I am currently out of the office. Our quote is attached.',null),
        (5,'Automatic reply: vacation','Away',null),
        (6,'Re: quote','Please see attached. > I am currently out of the office.',null)`);
      const { rows } = await db.query<{id:number}>(`select id from messages m where not ${automaticMessageSql("m", "$1")} order by id`, [AUTOMATIC_SUBJECT_SQL]);
      expect(rows.map(r => r.id)).toEqual([3,4,6]);
    } finally { await db.close(); }
  });
});
