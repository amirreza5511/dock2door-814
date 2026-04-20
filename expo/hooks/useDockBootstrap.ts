import { useMemo } from 'react';
import { trpc } from '@/lib/trpc';
import type { Company, ServiceJob, ServiceListing, WarehouseBooking, WarehouseListing } from '@/constants/types';

interface BootstrapData {
  companies: Company[];
  warehouseListings: WarehouseListing[];
  warehouseBookings: WarehouseBooking[];
  serviceListings: ServiceListing[];
  serviceJobs: ServiceJob[];
}

const EMPTY_DATA: BootstrapData = {
  companies: [],
  warehouseListings: [],
  warehouseBookings: [],
  serviceListings: [],
  serviceJobs: [],
};

export function useDockBootstrapData() {
  const query = trpc.dock.bootstrap.useQuery();

  const data = useMemo<BootstrapData>(() => {
    if (!query.data) {
      return EMPTY_DATA;
    }

    const payload = query.data as unknown as Partial<BootstrapData>;

    return {
      companies: payload.companies ?? [],
      warehouseListings: payload.warehouseListings ?? [],
      warehouseBookings: payload.warehouseBookings ?? [],
      serviceListings: payload.serviceListings ?? [],
      serviceJobs: payload.serviceJobs ?? [],
    };
  }, [query.data]);

  return {
    ...query,
    data,
  };
}
