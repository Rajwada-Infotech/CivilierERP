import axios from "./axios";

export interface BrsEntry {
  BRSID: number;
  BankID: number;
  TransactionID: number;
  Amount: number;
  Type: 'CREDIT' | 'DEBIT';
  IsMatched: boolean;
  BankDate: string;
  SystemDate: string;
  CreatedAt: string;
}

export interface BrsResponse {
  data: BrsEntry[];
  matched: number;
  unmatched: number;
  difference: number;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export const getBRS = (params: {
  bankId?: number;
  fromDate?: string;
  toDate?: string;
  page?: number;
  limit?: number;
}) => axios.get<BrsResponse>("/brs", { params });

export const addBRS = (data: {
  bankId: number;
  transactionId: number;
  amount: number;
  type: 'CREDIT' | 'DEBIT';
  bankDate: string;
  systemDate: string;
}) => axios.post("/brs", data);

export const matchBRS = (id: number) => axios.put(`/brs/${id}/match`);

export const unmatchBRS = (id: number) => axios.put(`/brs/${id}/unmatch`);

export const autoMatchBRS = () => axios.put("/brs/auto-match");

