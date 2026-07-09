export type UserRole =
  | "Customer"
  | "WarehouseProvider"
  | "ServiceProvider"
  | "Employer"
  | "Worker"
  | "TruckingCompany"
  | "Driver"
  | "GateStaff"
  | "Shipper"
  | "DrayageCompany"
  | "FreightForwarder"
  | "SalesAgent"
  | "Admin"
  | "SuperAdmin";

export type CompanyType =
  | "Customer"
  | "WarehouseProvider"
  | "ServiceProvider"
  | "Employer"
  | "TruckingCompany";

export interface Profile {
  id: string;
  email: string;
  name: string;
  role: UserRole | null;
  company_id: string | null;
  status: string | null;
  profile_image: string | null;
  created_at: string | null;
}

export interface CompanyMembership {
  company_id: string;
  user_id: string;
  role: string;
  company_name: string;
  company_type: CompanyType;
  company_status: string;
}
