// Keep communication history on the same instant parser and UTC display as
// the activity and provider ledgers. Existing callers retain minute precision.
export { storedTimestamp as communicationTimestamp } from "./stored-timestamp";
