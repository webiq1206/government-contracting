export interface ContractorGuide {
  slug: string;
  title: string;
  description: string;
  category: "Idaho contracting" | "Bid preparation";
  intro: string;
  sections: { heading: string; paragraphs?: string[]; checklist?: string[] }[];
  sources: { label: string; href: string }[];
  related: string[];
  productHref: string;
  productLabel: string;
}

const purchasing = { label: "Idaho Division of Purchasing: open and future solicitations", href: "https://purchasing.idaho.gov/open-and-future-solicitations/" };
const boise = { label: "City of Boise: vendor information and registration", href: "https://www.cityofboise.org/departments/finance/purchasing/vendor-information-and-registration/" };
const dpw = { label: "Idaho Division of Public Works: construction contracting", href: "https://dpw.idaho.gov/construction/" };
const sam = { label: "SAM.gov: federal contracting", href: "https://sam.gov/contracting" };
const apex = { label: "Idaho APEX Accelerator: government contracting assistance", href: "https://www.idahoapexaccelerator.com/" };

export const CONTRACTOR_GUIDES: ContractorGuide[] = [
  {
    slug: "idaho-government-contracts", title: "How to find Idaho government contracts",
    description: "Find official Idaho state, Boise, public works and federal bid sources, then use a practical checklist to qualify opportunities before preparing a response.",
    category: "Idaho contracting",
    intro: "Idaho government contracts are not published on one complete bid board. Start with the agency buying the work, then distinguish state purchasing, public works, city solicitations and federal notices with an Idaho place of performance.",
    sections: [
      { heading: "Choose the right official source", paragraphs: ["The Idaho Division of Purchasing lists the open and future solicitations it manages. That list does not include solicitations managed by every other agency. Use it as a starting point, not as proof that no other Idaho opportunities exist.", "For state-owned facility construction, check the Division of Public Works. For City of Boise work, start with the city's vendor registration page. For federal opportunities, use SAM.gov and evaluate the work location rather than assuming the buying office's address is the job site."] },
      { heading: "Build a search that matches your capacity", checklist: ["Write down the services you can perform, geographic coverage and realistic contract size.", "Search both everyday terms and the industry's terminology. A cleaning company should also try custodial and janitorial.", "Record the agency, notice identifier, official URL, closing time and time zone.", "Separate a future procurement, a sources-sought notice, a current solicitation and an award notice. They call for different actions."] },
      { heading: "Qualify before preparing a bid", checklist: ["Read the full notice, attachments and amendments, not just the search result.", "Check required qualifications, registrations, site visits, delivery capacity and submission instructions against the specific solicitation.", "Assign an owner to questions, subcontractor quotes and final review.", "Document a bid or no-bid decision with unresolved issues and a date for the next source check."] },
      { heading: "When you need help", paragraphs: ["Idaho APEX Accelerator offers no-cost government contracting assistance. Its bid-match subscription is a separate offering. Ask the official agency contact about a solicitation through the stated question process; a software-generated interpretation is not an agency answer."] },
    ], sources: [purchasing, dpw, boise, sam, apex], related: ["boise-government-bids", "government-bid-no-bid-checklist"], productHref: "/platform", productLabel: "See how BrostCo organizes a pursuit",
  },
  {
    slug: "boise-government-bids", title: "Where to find Boise government bids and RFPs",
    description: "Find City of Boise bid registration and nearby public procurement sources. Learn what to record, how to check amendments and when to pursue a local RFP.",
    category: "Idaho contracting",
    intro: "A search for Boise government bids can mean City of Boise purchasing, state work in Boise or a federal project in the Treasure Valley. Identify the buying entity before creating accounts or spending time on a response.",
    sections: [
      { heading: "Start with City of Boise purchasing", paragraphs: ["The city's vendor registration page directs vendors to its JAGGAER system. Follow the current instructions on that official page for viewing opportunities and participating. Register for the relevant categories and confirm that the email address receiving notices is monitored by your team.", "Do not assume that registering with one buyer subscribes you to every Treasure Valley agency. State agencies, highway districts and federal buyers have separate procurement sources."] },
      { heading: "Expand the search without losing relevance", checklist: ["Check Idaho Purchasing for state solicitations and Idaho Public Works for state facility projects.", "For road-related local work, check Ada County Highway District's bids and procurement page.", "Use SAM.gov for federal notices and verify the actual place of performance.", "Keep each buyer's official source link in your pursuit record so you can return to the correct amendments and instructions."] },
      { heading: "A local bid intake checklist", checklist: ["Can your crew cover the location and required service hours?", "Is there a mandatory meeting, walk-through or question deadline before the bid deadline?", "Are registrations, insurance, licenses or qualifications required for this specific work?", "Who will prepare the price, review the response and submit through the required channel?", "Have you recorded the latest amendment and assigned someone to check for later changes?"] },
      { heading: "From a posting to an organized pursuit", paragraphs: ["A local opportunity is not ready to bid just because it is nearby. Evaluate the scope, schedule, pricing evidence and available team together. If a requirement is unclear, use the buyer's designated questions process before committing to an interpretation.", "BrostCo supports manually importing a notice link or PDF for supported analysis. A manually imported local notice is a saved input, not a promise that the local portal is monitored for changes. Keep checking the official source."] },
    ], sources: [boise, purchasing, dpw, { label: "Ada County Highway District: bids and procurement", href: "https://www.achdidaho.org/projects/bids-procurement" }, sam], related: ["idaho-government-contracts", "idaho-government-construction-bids"], productHref: "/demo", productLabel: "Explore a sample pursuit",
  },
  {
    slug: "idaho-government-construction-bids", title: "Finding and qualifying Idaho government construction bids",
    description: "Use official Idaho construction bid sources and a practical review checklist for plans, site visits, addenda, trade coverage and quote deadlines.",
    category: "Idaho contracting",
    intro: "Government construction bid research should start with the type of owner and project. A state building renovation, city facility project and highway procurement can be advertised through different sources and have different response requirements.",
    sections: [
      { heading: "Find the project at its official source", paragraphs: ["The Idaho Division of Public Works publishes construction bid advertisements and results for its state facility work. Use the project identifier and current documents to distinguish an active advertisement from a past result. City and highway work should also be checked with the relevant purchasing authority."] },
      { heading: "Review before requesting trade pricing", checklist: ["Download the scope, specifications, drawings and available addenda. Keep their revision identifiers.", "Confirm the bid time, submission method and any required site visit.", "Check the project's stated licensing, insurance, bonding and qualification requirements with the source documents and appropriate adviser.", "Identify which work your team will self-perform and which trades need quotes.", "Record unanswered scope questions and use the official question deadline."] },
      { heading: "Create a comparable quote request", paragraphs: ["Give each trade the same scope boundaries and document revisions. State the job location, schedule, quote deadline and how to list exclusions. Ask whether the quote includes labor, materials, equipment, travel and any applicable taxes rather than silently assuming it does.", "Keep alternate prices separate from the base scope. A lower price with missing work is not directly comparable to a complete quote. Record the clarification and its owner before using that price in the bid."] },
      { heading: "Review the package as a team", checklist: ["Recheck the official source for addenda before finalizing.", "Confirm trade coverage, exclusions and quote validity against the current scope.", "Assign a reviewer for required forms and signatures.", "Use the specified submission channel and keep the receipt or confirmation."] },
    ], sources: [dpw, boise, { label: "Idaho Transportation Department: advertised projects", href: "https://itd.idaho.gov/contractor-bidding/" }], related: ["subcontractor-quote-request-checklist", "proposal-compliance-matrix"], productHref: "/subcontractors", productLabel: "See subcontractor coordination",
  },
  {
    slug: "idaho-janitorial-government-contracts", title: "How to evaluate Idaho janitorial government contracts",
    description: "Find Idaho custodial and janitorial bid sources and review service hours, site scope, staffing, supplies and pricing assumptions before bidding.",
    category: "Idaho contracting",
    intro: "A janitorial contract is a service commitment, not just a building size and a monthly price. Search official Idaho and federal sources, then translate the specific cleaning requirements into a staffing and cost plan your team can deliver.",
    sections: [
      { heading: "Search beyond one phrase", paragraphs: ["Try janitorial, custodial, cleaning and facility services on relevant official bid sources. Check Idaho Purchasing, the local government purchasing office and SAM.gov for federal work. A keyword match is only a lead; inspect whether the scope actually matches your business."] },
      { heading: "Extract the operating requirements", checklist: ["List the buildings, locations, approximate areas and types of spaces from the solicitation.", "Record task frequencies separately: daily work, periodic floor care, windows and special requests may be priced differently.", "Confirm access hours, security procedures and staffing or supervision requirements.", "Identify who supplies consumables, chemicals, equipment and storage.", "Note site visits, quality inspections, reporting and response-time expectations."] },
      { heading: "Build the price from the work", paragraphs: ["Estimate labor from the actual service schedule, then account for supervision, coverage, travel, supplies and equipment. Verify any compensation or other contractual requirements in the solicitation with a qualified adviser when needed. Do not treat an AI estimate as an agency budget or a confirmed labor cost.", "If you use a subcontractor, send the same task schedule and scope boundaries to every candidate. Ask them to state exclusions and quote validity. A monthly figure without frequency and coverage assumptions is not a complete comparable quote."] },
      { heading: "Decide whether to pursue", checklist: ["Can the proposed crew meet the schedule without weakening existing contracts?", "Are required qualifications and access arrangements feasible before performance starts?", "Have unclear tasks and quantities been resolved through the official question process?", "Does the price still work after realistic coverage and overhead?", "Who owns amendment checks, final review and submission?"] },
    ], sources: [purchasing, boise, sam], related: ["idaho-government-contracts", "government-bid-no-bid-checklist", "subcontractor-quote-request-checklist"], productHref: "/ai", productLabel: "See how AI prepares a working brief",
  },
  {
    slug: "government-bid-no-bid-checklist", title: "A government bid/no-bid checklist for small teams",
    description: "Use a repeatable bid/no-bid checklist to assess eligibility, scope, deadlines, capacity, pricing evidence and review ownership before committing to a bid.",
    category: "Bid preparation",
    intro: "A bid/no-bid decision should explain why a pursuit deserves your time. A numerical fit score can help sort the pipeline, but it cannot replace eligibility checks, delivery judgment or a review of the current solicitation.",
    sections: [
      { heading: "First, check the hard stops", checklist: ["Identify the current notice, attachments and latest amendment.", "Check required eligibility, registrations, certifications and qualifications against your actual status.", "Confirm whether required site visits or other milestones have already passed.", "Record the deadline with its time zone and the specified submission method.", "Escalate a missing mandatory requirement instead of letting a high fit score hide it."] },
      { heading: "Then assess whether the pursuit makes sense", checklist: ["Scope fit: can you explain the deliverables in your own words?", "Capacity: are the people, equipment and geographic coverage available?", "Evidence: do you have relevant experience and the information needed for the response?", "Pricing: are quantities, supplier costs and subcontractor quotes sufficiently supported?", "Timing: is there enough time for questions, drafting, review and submission?", "Risk: what remains uncertain, who owns it and when must it be resolved?"] },
      { heading: "Record a decision, not just a score", paragraphs: ["Use three outcomes: pursue, decline or hold for a named clarification. Record the decision owner, date, evidence and unresolved items. A hold needs a review date before the actual bid deadline; otherwise it becomes an invisible decline.", "Review the decision when an amendment changes the scope, when a quote fails to arrive or when capacity changes. An older AI explanation may describe a different deadline or earlier set of documents. Use the current source and current record."] },
      { heading: "Make the next step explicit", paragraphs: ["For a pursuit, assign the requirements checklist, pricing owner and final reviewer. For a decline, record a short reason you can use to improve future targeting. For a clarification, write the question and send it only through the buyer's permitted process. This checklist is a working aid, not a substitute for the solicitation or professional advice."] },
    ], sources: [sam, apex], related: ["proposal-compliance-matrix", "sam-gov-opportunity-search"], productHref: "/platform", productLabel: "Explore the bid workflow",
  },
  {
    slug: "proposal-compliance-matrix", title: "How to build a government proposal compliance matrix",
    description: "Turn solicitation requirements into a practical proposal compliance matrix with source references, owners, evidence, review status and amendment checks.",
    category: "Bid preparation",
    intro: "A proposal compliance matrix connects each requirement to the place it is answered and the person checking it. It helps prevent a polished proposal from missing a mandatory form, attachment or instruction.",
    sections: [
      { heading: "Use one row for each checkable requirement", paragraphs: ["Start with the solicitation and attachments, including available amendments. Separate a submission instruction from a technical requirement and an evaluation criterion. They may appear in different sections and require different evidence.", "Suggested columns: requirement ID, source document and section, requirement, response location, owner, supporting evidence, status and reviewer. Add the document revision or amendment identifier so the source remains traceable."] },
      { heading: "Example rows for your working sheet", checklist: ["Submission deadline | notice section | date, time and zone | submission owner | calendar and source checked | pending.", "Technical approach | solicitation section | required explanation | proposal section | author | evidence attached | in review.", "Required attachment | instructions | named form | package filename | document owner | completed form | reviewer approved.", "Amendment change | amendment identifier | revised requirement | affected response section | owner | revision checked | pending."] },
      { heading: "Make status mean something", paragraphs: ["Use a small set of states: not started, drafting, needs clarification, ready for review and verified. Ready for review is not the same as verified. A reviewer should check the actual response and evidence against the source before closing the row.", "Do not treat a generated checklist as complete merely because every generated row has a checkmark. Compare it with the full source documents to find requirements the extraction missed. AI output is a draft aid, not a compliance certification."] },
      { heading: "Review again after amendments", checklist: ["Keep the official source link and latest amendment identifier with the matrix.", "Mark affected rows for re-review when requirements change.", "Check file formats, page limits, signatures and submission instructions explicitly.", "Resolve unknowns or record the responsible decision before submission.", "Save the reviewed matrix with the final package and submission confirmation."] },
    ], sources: [sam], related: ["government-bid-no-bid-checklist", "subcontractor-quote-request-checklist"], productHref: "/ai", productLabel: "See requirement analysis and human review",
  },
  {
    slug: "subcontractor-quote-request-checklist", title: "A subcontractor quote request checklist for government bids",
    description: "Prepare clearer subcontractor quote requests with scope boundaries, document revisions, quote deadlines, exclusions and a comparison checklist.",
    category: "Bid preparation",
    intro: "A useful quote request gives a subcontractor enough context to decide whether to price the work and enough structure for your team to compare the answer. Sending more emails cannot fix an unclear scope.",
    sections: [
      { heading: "Prepare the request", checklist: ["Identify your company, the project, location and requested trade.", "Share the applicable scope and document revisions through an appropriate access method.", "State the quote deadline separately from the government bid deadline.", "Describe expected work dates, site constraints and any known visit requirement.", "Ask for inclusions, exclusions, assumptions, alternate prices and quote validity.", "Provide a clear reply contact and explain how questions will be handled."] },
      { heading: "Make the scope boundaries visible", paragraphs: ["Ask what labor, materials, equipment, travel, testing and cleanup are included where relevant. Identify interfaces between trades so two quotes do not both exclude the same responsibility. Share changes with every affected candidate, not just the first person to reply.", "Do not include controlled, sensitive or restricted material in a general outreach email. Confirm the applicable handling requirements and use an approved sharing process. A connected mailbox does not itself establish permission to distribute every attachment."] },
      { heading: "Review the response before accepting the number", checklist: ["Confirm that the reply is a quote rather than an acknowledgment or a request for information.", "Match the price to the trade, scope version, units and quantities.", "Check exclusions, allowances, expiration and missing assumptions.", "Keep an unconfirmed number separate from a verified quote.", "Record who resolved each clarification and retain the supporting message."] },
      { heading: "Follow up with a purpose", paragraphs: ["Prioritize missing coverage and unresolved scope, not simply contacts who have not replied. Respect opt-outs and your contact rules. If a phone call is needed, give the caller the project context and the exact question rather than another generic task.", "BrostCo can coordinate outreach and replies through connected services under your rules. Your team still confirms unclear pricing, qualifications and final trade coverage before relying on them in the bid."] },
    ], sources: [sam], related: ["idaho-government-construction-bids", "proposal-compliance-matrix"], productHref: "/subcontractors", productLabel: "Explore the subcontractor workflow",
  },
  {
    slug: "sam-gov-opportunity-search", title: "How to search SAM.gov opportunities for your business",
    description: "Build a focused federal opportunity search using services, industry codes, place of performance and notice type, then qualify the results against source documents.",
    category: "Bid preparation",
    intro: "SAM.gov is an official starting point for federal contracting research. A good search narrows the work to what your team can deliver, while leaving enough room for the different words agencies use to describe the same service.",
    sections: [
      { heading: "Define the work before choosing filters", checklist: ["List your main services and common synonyms.", "Identify the industry codes relevant to the work rather than using a code only because it produces many results.", "Choose a realistic service area and verify the actual place of performance.", "Distinguish active solicitations from early research notices and award information.", "Evaluate set-aside and other eligibility requirements against your actual business status."] },
      { heading: "Use a small portfolio of searches", paragraphs: ["A single tightly filtered search can miss work; a broad one can create a queue nobody reviews. Try a service-keyword search, a relevant industry-code search and a target-agency search. Compare the results and refine based on genuine fit, not the raw count.", "For Idaho work, do not confuse the address of the buying office with the location where the contract is performed. A local federal project can be managed by an office elsewhere, while an Idaho office can buy work in another location."] },
      { heading: "Turn each promising result into a record", checklist: ["Save the official URL and notice identifier.", "Read the current notice, attachments and amendments.", "Record the deadline, question date, submission method and any required visit.", "Identify missing documents and questions before scoring the pursuit as ready.", "Assign an owner to the bid/no-bid decision and the next amendment check."] },
      { heading: "Know where the software fits", paragraphs: ["BrostCo uses your profile and connected services to discover and prepare work around supported federal notices. Source availability, document access and provider limits can affect what it can analyze. Check the activity and source evidence rather than assuming every background step succeeded.", "SAM.gov remains the authoritative source for its notices. BrostCo does not replace government registration, agency clarification, final review or the required submission channel. Local and state opportunities use separate sources; manually importing one does not automatically monitor its portal."] },
    ], sources: [sam, apex], related: ["government-bid-no-bid-checklist", "idaho-government-contracts"], productHref: "/get-started", productLabel: "Prepare your first opportunity review",
  },
];

export function contractorGuide(slug: string): ContractorGuide {
  const guide = CONTRACTOR_GUIDES.find((item) => item.slug === slug);
  if (!guide) throw new Error(`Unknown contractor guide: ${slug}`);
  return guide;
}
