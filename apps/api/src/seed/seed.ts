// Demo data for local/stakeholder demos: a default admin account (who also
// owns the sample listings), a demo tenant, and a set of listings across
// Cameroonian cities with real photos (apps/api/seed-assets, from Unsplash —
// see seed-assets/CREDITS.md).
//
// Run with:  npm run seed            (from the repo root; execs inside the api container)
//       or:  npm run seed --workspace=apps/api   (locally, needs DATABASE_URL)
//
// Everything goes through the same services the HTTP API uses (listing rules,
// photo upload, tenancy creation, events) rather than raw inserts, so the
// data is exactly what real usage would produce. Idempotent: re-running skips
// whatever already exists, so it's safe to run again after the e2e suite
// (which wipes the shared dev database) or on top of existing demo data.

import { NestFactory } from '@nestjs/core';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { KycTier, UserRole } from '@prisma/client';
import { AppModule } from '../app.module';
import { PrismaService } from '../common/prisma.service';
import { UsersService } from '../modules/auth/users.service';
import { PropertiesService } from '../modules/properties/properties.service';
import { UnitsService } from '../modules/properties/units.service';
import { TenanciesService } from '../modules/tenancies/tenancies.service';
import { VisitsService } from '../modules/visits/visits.service';
import { PROPERTY_TYPES } from '../modules/properties/dto/create-property.dto';

// Must match DEMO_ACCOUNT_PHONES (docker-compose.yml / .env.example) for the
// fixed demo OTP to apply to these accounts.
export const DEMO_ADMIN_PHONE = '+237600000001';
export const DEMO_TENANT_PHONE = '+237600000002';

const PHOTO = {
  kitchenWhite: '1484154218962-a197022b5858.jpg',
  livingBlue: '1493809842364-78817add7ffb.jpg',
  officeCorridor: '1497366216548-37526070297c.jpg',
  officeLoft: '1497366811353-6870744d04b2.jpg',
  livingPlants: '1502672260266-1c1ef2d93688.jpg',
  kitchenRed: '1522708323590-d24dbb6b0267.jpg',
  houseCubic: '1523217582562-09d0def993a6.jpg',
  bedroomOrange: '1540518614846-7eded433c457.jpg',
  livingOrange: '1554995207-c18c203602cb.jpg',
  kitchenIsland: '1556912172-45b7abe8b7e1.jpg',
  diningRoom: '1560185007-cde436f6a4d0.jpg',
  livingBright: '1560448204-e02f11c3d0e2.jpg',
  housePalm: '1564013799919-ab600027ffc6.jpg',
  houseColonial: '1570129477492-45c003edd2be.jpg',
  aptBrick: '1574362848149-11496d93a7c7.jpg',
  livingBeige: '1580587771525-78b9dba3b914.jpg',
  livingStairs: '1600566753086-00f18fb6b3ea.jpg',
  bedroomChair: '1600573472591-ee6b68d14c68.jpg',
  houseDark: '1600585154340-be6161a56a0c.jpg',
  villaWhitePool: '1600596542815-ffad4c1539a9.jpg',
  livingWood: '1600607687939-ce8a6c25118c.jpg',
  livingPatio: '1604014237800-1c9102c219da.jpg',
  villaPool: '1613490493576-7fde63acd811.jpg',
} as const;

interface UnitSeed {
  label: string;
  quantity?: number;
  bedrooms?: number;
  bathrooms: number;
  sizeSqm: number;
  rent: number;
  facilities: string[];
  description: string;
  photos: string[]; // first one is the cover
}

interface PropertySeed {
  name: string;
  propertyType: (typeof PROPERTY_TYPES)[number];
  facilities: string[];
  addressLine: string;
  city: string;
  region: string;
  latitude: number;
  longitude: number;
  units: UnitSeed[];
}

// Listings are shown newest-first, so this list runs from the least to the
// most eye-catching: the villa at the bottom is what a visitor sees first.
const PROPERTIES: PropertySeed[] = [
  {
    name: 'Akwa Business Center',
    propertyType: 'commercial',
    facilities: ['generator', 'security_personnel'],
    addressLine: 'Boulevard de la Liberté, Akwa',
    city: 'Douala',
    region: 'Littoral',
    latitude: 4.0511,
    longitude: 9.6969,
    units: [
      {
        label: 'Private Office',
        quantity: 2,
        bathrooms: 1,
        sizeSqm: 25,
        rent: 140000,
        facilities: ['ac', 'wifi'],
        description:
          'Furnished private office with shared reception, high-speed fibre internet and round-the-clock building security. Ideal for consultants and small teams.',
        photos: [PHOTO.officeCorridor, PHOTO.officeLoft],
      },
      {
        label: 'Open-plan Office',
        bathrooms: 2,
        sizeSqm: 60,
        rent: 300000,
        facilities: ['ac', 'wifi'],
        description:
          'Bright open-plan floor with floor-to-ceiling windows, meeting area and two washrooms. Flexible layout for up to 15 desks.',
        photos: [PHOTO.officeLoft, PHOTO.officeCorridor],
      },
    ],
  },
  {
    name: 'Résidence Mont Fako',
    propertyType: 'mixed_use',
    facilities: ['gated', 'borehole'],
    addressLine: 'Molyko, Buea',
    city: 'Buea',
    region: 'Southwest',
    latitude: 4.1527,
    longitude: 9.2412,
    units: [
      {
        label: 'Student Studio',
        quantity: 3,
        bathrooms: 1,
        sizeSqm: 24,
        rent: 55000,
        facilities: ['wifi', 'hot_water'],
        description:
          'Compact, bright studio a short walk from the University of Buea. Private bathroom, kitchenette and reliable water from the on-site borehole.',
        photos: [PHOTO.livingPlants, PHOTO.kitchenWhite],
      },
      {
        label: 'Contemporary 3-Bedroom House',
        bedrooms: 3,
        bathrooms: 3,
        sizeSqm: 240,
        rent: 480000,
        facilities: ['ac', 'wifi', 'hot_water'],
        description:
          'Architect-designed family home with open-plan living, a covered terrace and a landscaped garden, set in a quiet gated compound at the foot of Mount Fako.',
        photos: [PHOTO.houseDark, PHOTO.livingPatio, PHOTO.livingWood],
      },
    ],
  },
  {
    name: 'Cité Bastos',
    propertyType: 'residential',
    facilities: ['gated', 'security_personnel', 'generator'],
    addressLine: 'Rue 1.750, Bastos',
    city: 'Yaoundé',
    region: 'Centre',
    latitude: 3.8963,
    longitude: 11.5167,
    units: [
      {
        label: 'Garden Maisonette',
        bedrooms: 2,
        bathrooms: 1,
        sizeSqm: 68,
        rent: 180000,
        facilities: ['hot_water'],
        description:
          'Charming two-bedroom maisonette with a private garden, ten minutes from the embassies district. Quiet street, shared generator backup.',
        photos: [PHOTO.houseCubic, PHOTO.kitchenIsland],
      },
      {
        label: '3-Bedroom Apartment',
        bedrooms: 3,
        bathrooms: 2,
        sizeSqm: 110,
        rent: 350000,
        facilities: ['ac', 'wifi', 'hot_water'],
        description:
          'Spacious, sun-filled apartment on the second floor with a large living-dining area and an equipped kitchen. 24/7 guarded access and generator backup.',
        photos: [PHOTO.livingBeige, PHOTO.diningRoom, PHOTO.kitchenRed],
      },
    ],
  },
  {
    name: 'Résidence Bonapriso',
    propertyType: 'residential',
    facilities: ['gated', 'generator', 'borehole', 'security_personnel'],
    addressLine: 'Rue Njo-Njo, Bonapriso',
    city: 'Douala',
    region: 'Littoral',
    latitude: 4.0435,
    longitude: 9.7043,
    units: [
      {
        label: 'Furnished Studio',
        quantity: 2,
        bathrooms: 1,
        sizeSqm: 32,
        rent: 90000,
        facilities: ['ac', 'wifi', 'hot_water', 'furnished'],
        description:
          'Move-in-ready furnished studio in the heart of Bonapriso. Air conditioning, fast wifi and hot water included; restaurants and shops within walking distance.',
        photos: [PHOTO.livingBlue, PHOTO.kitchenWhite, PHOTO.bedroomOrange],
      },
      {
        label: '2-Bedroom Apartment',
        bedrooms: 2,
        bathrooms: 2,
        sizeSqm: 78,
        rent: 220000,
        facilities: ['ac', 'wifi', 'hot_water'],
        description:
          'Modern two-bedroom apartment with a bright living room, a fully fitted kitchen and two bathrooms, in a secure residence with its own generator and borehole.',
        photos: [PHOTO.livingBright, PHOTO.kitchenIsland, PHOTO.bedroomChair, PHOTO.aptBrick],
      },
    ],
  },
  {
    name: 'Limbe Ocean View',
    propertyType: 'residential',
    facilities: ['generator', 'borehole'],
    addressLine: 'Down Beach, Limbe',
    city: 'Limbe',
    region: 'Southwest',
    latitude: 4.0186,
    longitude: 9.2143,
    units: [
      {
        label: '3-Bedroom Seaside Villa',
        bedrooms: 3,
        bathrooms: 3,
        sizeSqm: 260,
        rent: 600000,
        facilities: ['ac', 'wifi', 'hot_water'],
        description:
          'Tropical villa with a private pool, a wraparound veranda and sea breezes, a few minutes from the black-sand beaches of Limbe. Backup generator and borehole on site.',
        photos: [PHOTO.housePalm, PHOTO.livingOrange, PHOTO.livingStairs],
      },
    ],
  },
  {
    name: 'Villa Odza',
    propertyType: 'residential',
    facilities: ['gated', 'generator', 'borehole', 'security_personnel'],
    addressLine: 'Odza, Yaoundé',
    city: 'Yaoundé',
    region: 'Centre',
    latitude: 3.8021,
    longitude: 11.5345,
    units: [
      {
        label: '4-Bedroom Villa with Pool',
        bedrooms: 4,
        bathrooms: 4,
        sizeSqm: 320,
        rent: 850000,
        facilities: ['ac', 'wifi', 'hot_water'],
        description:
          'Landmark contemporary villa with a swimming pool, double-height living room and a fully equipped kitchen. Gated compound with guard house, generator and borehole.',
        photos: [PHOTO.villaWhitePool, PHOTO.villaPool, PHOTO.livingStairs, PHOTO.livingWood],
      },
    ],
  },
];

// A tenant's own tenancy, so the demo tenant's dashboard is not empty. The
// unit gets its photo first (that's what makes it rentable) and then goes
// occupied, i.e. it is intentionally NOT in the public listings.
const OCCUPIED_PROPERTY: PropertySeed = {
  name: 'Bonamoussadi Court',
  propertyType: 'residential',
  facilities: ['gated', 'borehole'],
  addressLine: 'Rue des Palmiers, Bonamoussadi',
  city: 'Douala',
  region: 'Littoral',
  latitude: 4.0847,
  longitude: 9.7343,
  units: [
    {
      label: '2-Bedroom Apartment',
      bedrooms: 2,
      bathrooms: 1,
      sizeSqm: 72,
      rent: 200000,
      facilities: ['ac', 'hot_water'],
      description: 'Comfortable two-bedroom apartment with a private balcony.',
      photos: [PHOTO.diningRoom, PHOTO.houseColonial],
    },
  ],
};

const assetsDir = join(process.cwd(), 'seed-assets');

async function asMulterFile(name: string): Promise<Express.Multer.File> {
  const buffer = await readFile(join(assetsDir, name));
  return { buffer, originalname: name } as Express.Multer.File;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const users = app.get(UsersService, { strict: false });
  const properties = app.get(PropertiesService, { strict: false });
  const units = app.get(UnitsService, { strict: false });
  const tenancies = app.get(TenanciesService, { strict: false });
  const visits = app.get(VisitsService, { strict: false });

  async function ensureUser(phoneNumber: string, fullName: string, roles: UserRole[]) {
    const user = await prisma.user.upsert({
      where: { phoneNumber },
      update: { fullName },
      create: { phoneNumber, fullName, locale: 'en', kycTier: KycTier.id_verified },
    });
    for (const role of roles) await users.ensureRole(user.id, role);
    return user;
  }

  const admin = await ensureUser(DEMO_ADMIN_PHONE, 'Platform Admin', [
    UserRole.tenant,
    UserRole.landlord,
    UserRole.admin,
  ]);
  const tenant = await ensureUser(DEMO_TENANT_PHONE, 'Nadège Fotso', [UserRole.tenant]);

  let createdProperties = 0;
  let createdUnits = 0;
  const unitIdsByLabel = new Map<string, string>();

  async function seedProperty(seed: PropertySeed): Promise<string[]> {
    const existing = await prisma.property.findFirst({ where: { landlordId: admin.id, name: seed.name } });
    if (existing) {
      console.log(`  = ${seed.name} already exists, skipping`);
      return [];
    }

    const property = await properties.createProperty(admin.id, {
      name: seed.name,
      property_type: seed.propertyType,
      facilities: seed.facilities,
      address_line: seed.addressLine,
      city: seed.city,
      region: seed.region,
      latitude: seed.latitude,
      longitude: seed.longitude,
    });
    // Sample properties show the "Verified" badge — set directly because
    // ownership verification is an admin action with no UI/endpoint yet.
    await prisma.property.update({
      where: { id: property.id },
      data: { ownershipVerifiedAt: new Date(), ownershipVerifiedBy: admin.id },
    });
    createdProperties++;

    const unitIds: string[] = [];
    for (const u of seed.units) {
      const result = await properties.createUnit(admin.id, property.id, {
        label: u.label,
        quantity: u.quantity,
        bedrooms: u.bedrooms,
        bathrooms: u.bathrooms,
        size_sqm: u.sizeSqm,
        rent_amount: u.rent,
        facilities: u.facilities,
        description: u.description,
      });
      const created = 'units' in result ? result.units : [result];
      for (const unit of created) {
        for (const photo of u.photos) {
          await units.uploadPhoto(admin.id, unit.id, {}, await asMulterFile(photo));
        }
        unitIds.push(unit.id);
        unitIdsByLabel.set(`${seed.name}/${unit.label ?? u.label}`, unit.id);
        createdUnits++;
      }
    }
    console.log(`  + ${seed.name} (${seed.city}): ${unitIds.length} unit(s)`);
    return unitIds;
  }

  console.log('Seeding sample properties and listings…');
  for (const p of PROPERTIES) await seedProperty(p);

  const occupiedIds = await seedProperty(OCCUPIED_PROPERTY);
  if (occupiedIds.length > 0) {
    await tenancies.createTenancy(admin.id, {
      unit_id: occupiedIds[0],
      tenant_id: tenant.id,
      start_date: '2026-08-01',
      rent_amount: OCCUPIED_PROPERTY.units[0].rent,
      max_advance_months: 3,
      // Three months of cash paid upfront, recorded by the landlord — so the
      // demo tenant's dashboard shows paid-through, months ahead, a ledger
      // entry and a receipt from the first login.
      prepaid_months: 3,
      prepaid_paid_on: '2026-08-01', // paid in cash on move-in day
    });
    console.log('  + demo tenancy created for the demo tenant (3 months recorded as paid upfront)');
  }

  // One pending interest, so the landlord's "Interested tenants" card isn't
  // empty on first login. Idempotent (expressInterest returns the existing row).
  const bastos = unitIdsByLabel.get('Cité Bastos/3-Bedroom Apartment');
  if (bastos) await visits.expressInterest(tenant.id, bastos);

  // Give the in-process event listeners (notifications) a moment to finish
  // before closing the DB connection underneath them.
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await app.close();

  const staticOtp = process.env.DEMO_STATIC_OTP;
  console.log(`\nDone: ${createdProperties} new properties, ${createdUnits} new units.\n`);
  console.log('Demo accounts (sign in with phone + one-time code):');
  console.log(`  Admin / landlord   ${DEMO_ADMIN_PHONE}`);
  console.log(`  Demo tenant        ${DEMO_TENANT_PHONE}`);
  console.log(
    staticOtp
      ? `  One-time code      ${staticOtp}   (fixed for these two accounts only)`
      : '  DEMO_STATIC_OTP is not set — the code will be in the api logs (SMS stub) instead.',
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
