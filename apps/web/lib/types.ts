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
  | "EquipmentRentalCompany"
  | "MobileRepairProvider"
  | "CargoInsurer"
  | "MarketplaceBuyer"
  | "SalesAgent"
  | "EmploymentAgency"
  | "CustomsBroker"
  | "ImporterExporter"
  | "GlobalFreightForwarder"
  | "Carrier"
  | "Guest"
  | "Admin"
  | "SuperAdmin";

export type CompanyType =
  | "Customer"
  | "WarehouseProvider"
  | "ServiceProvider"
  | "Employer"
  | "TruckingCompany"
  | "EquipmentRentalCompany"
  | "MobileRepairProvider"
  | "CargoInsurer"
  | "MarketplaceBuyer"
  | "EmploymentAgency"
  | "CustomsBroker"
  | "ImporterExporter"
  | "GlobalFreightForwarder"
  | "Carrier";

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
