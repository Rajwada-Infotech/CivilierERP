import axios from "./axios";

export interface BrsEntry {
  BRSID:         number;
  BankID:        number;
  CompanyID:     number | null;   // resolved via bank's LParentId, may be null
  TransactionID: number;
  Amount:        number;
  Type:          "CREDIT" | "DEBIT";
  IsMatched:     boolean;
  BankDate:      string;
  SystemDate:    string;
  CreatedAt:     string;
  BankName:      string | null;
  CompanyName:   string | null;
}

export interface BrsResponse {
  data:       BrsEntry[];
  matched:    number;
  unmatched:  number;
  difference: number;
  page:       number;
  limit:      number;
  total:      number;
  totalPages: number;
}

export interface BrsFilterOption {
  id:           number;
  name:         string;
  companyId?:   number | null;    // only on banks — resolved via LBelongsTo
  companyName?: string | null;    // only on banks — the matched company name
}

export interface BrsFilters {
  companies: BrsFilterOption[];
  banks:     BrsFilterOption[];
}

export const getBRSFilters = () =>
  axios.get<BrsFilters>("/brs/filters");

export const getBRS = (params: {
  bankId?:     number;
  companyId?:  number;   // filters via bank's LParentId on backend
  fromDate?:   string;
  toDate?:     string;
  status?:     "reconciled" | "pending";
  page?:       number;
  limit?:      number;
}) => axios.get<BrsResponse>("/brs", { params });

// No companyId field — BankReconciliation table has no CompanyID column.
// Company is resolved from bank.LBelongsTo matching company.LHeadName in AccountHeadMaster.
export const addBRS = (data: {
  bankId:        number;
  transactionId: number;
  amount:        number;
  type:          "CREDIT" | "DEBIT";
  bankDate:      string;
  systemDate:    string;
}) => axios.post("/brs", data);

export const matchBRS     = (id: number) => axios.put(`/brs/${id}/match`);
export const unmatchBRS   = (id: number) => axios.put(`/brs/${id}/unmatch`);
export const autoMatchBRS = ()           => axios.put("/brs/auto-match");