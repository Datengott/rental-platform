import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaModule } from '../src/common/prisma.module';
import { StorageModule } from '../src/common/storage/storage.module';
import { AuthModule } from '../src/modules/auth/auth.module';
import { PropertiesModule } from '../src/modules/properties/properties.module';
import { TenanciesModule } from '../src/modules/tenancies/tenancies.module';
import { configureApp } from '../src/setup-app';
import { PrismaService } from '../src/common/prisma.service';
import { SMS_GATEWAY } from '../src/modules/auth/sms/sms-gateway';
import { FakeSmsGateway, randomPhoneNumber } from './support/fake-sms-gateway';
import { signUp } from './support/sign-up';

interface Change {
  id: string;
  entity_type: string;
  action: string;
  entity_label: string | null;
  changes: { field: string; from: unknown; to: unknown }[];
  note: string | null;
  while_occupied: boolean;
  property_verified_at_change: boolean;
  changed_by?: string;
}

describe('Editing listings, and the change history (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fakeSms: FakeSmsGateway;

  beforeAll(async () => {
    fakeSms = new FakeSmsGateway();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        EventEmitterModule.forRoot(),
        ScheduleModule.forRoot(),
        PrismaModule,
        StorageModule,
        AuthModule,
        PropertiesModule,
        TenanciesModule,
      ],
    })
      .overrideProvider(SMS_GATEWAY)
      .useValue(fakeSms)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    app.enableShutdownHooks();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    await prisma.listingChange.deleteMany();
    await prisma.paymentWebhookRaw.deleteMany();
    await prisma.ledgerEntry.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.terminationNotice.deleteMany();
    await prisma.tenancy.deleteMany();
    await prisma.unitPhoto.deleteMany();
    await prisma.unit.deleteMany();
    await prisma.property.deleteMany();
    await prisma.session.deleteMany();
    await prisma.otpChallenge.deleteMany();
    await prisma.userRoleAssignment.deleteMany();
    await prisma.user.deleteMany();
  });

  async function createListing(token: string, photos = 1) {
    const property = await request(app.getHttpServer())
      .post('/v1/properties')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Residence Test', address_line: '1 Rue Test', city: 'Douala', property_type: 'residential', facilities: ['gated'] })
      .expect(201);
    const unit = await request(app.getHttpServer())
      .post(`/v1/properties/${property.body.id}/units`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'Studio A', rent_amount: 150000, bedrooms: 1, description: 'Bright studio' })
      .expect(201);
    for (let i = 0; i < photos; i++) {
      await request(app.getHttpServer())
        .post(`/v1/units/${unit.body.id}/photos`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('fake-image'), `photo${i}.jpg`)
        .expect(201);
    }
    return { propertyId: property.body.id as string, unitId: unit.body.id as string };
  }

  const patchUnit = (token: string, unitId: string, body: object) =>
    request(app.getHttpServer()).patch(`/v1/units/${unitId}`).set('Authorization', `Bearer ${token}`).send(body);
  const patchProperty = (token: string, propertyId: string, body: object) =>
    request(app.getHttpServer()).patch(`/v1/properties/${propertyId}`).set('Authorization', `Bearer ${token}`).send(body);
  const myChanges = async (token: string, query = '') =>
    (await request(app.getHttpServer()).get(`/v1/landlords/me/listing-changes${query}`).set('Authorization', `Bearer ${token}`).expect(200))
      .body.results as Change[];

  it('lets a landlord edit every detail of a unit and a property, recording exactly what changed', async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const { propertyId, unitId } = await createListing(landlord.access_token);

    const unit = await patchUnit(landlord.access_token, unitId, {
      label: 'Studio B',
      bedrooms: 2,
      bathrooms: 1,
      facilities: ['ac', 'wifi'],
      size_sqm: 40,
      rent_amount: 175000,
      billing_cycle: 'quarterly',
      description: 'Renovated',
      change_note: 'Renovation finished',
    }).expect(200);
    expect(unit.body).toMatchObject({ label: 'Studio B', bedrooms: 2, facilities: ['ac', 'wifi'], billing_cycle: 'quarterly' });

    const property = await patchProperty(landlord.access_token, propertyId, {
      name: 'Résidence Nouvelle',
      property_type: 'mixed_use',
      facilities: ['gated', 'generator'],
      address_line: '2 Rue Neuve',
      city: 'Yaoundé',
      region: 'Centre',
      latitude: 3.87,
      longitude: 11.52,
    }).expect(200);
    expect(property.body).toMatchObject({ name: 'Résidence Nouvelle', city: 'Yaoundé', property_type: 'mixed_use', latitude: '3.87' });

    const changes = await myChanges(landlord.access_token);
    expect(changes).toHaveLength(2);
    const unitChange = changes.find((c) => c.entity_type === 'unit')!;
    expect(unitChange.note).toBe('Renovation finished');
    expect(unitChange.changes.find((c) => c.field === 'rent_amount')).toEqual({ field: 'rent_amount', from: 150000, to: 175000 });
    expect(unitChange.changes.find((c) => c.field === 'label')).toEqual({ field: 'label', from: 'Studio A', to: 'Studio B' });
    expect(unitChange.while_occupied).toBe(false);
    const propertyChange = changes.find((c) => c.entity_type === 'property')!;
    expect(propertyChange.changes.find((c) => c.field === 'city')).toEqual({ field: 'city', from: 'Douala', to: 'Yaoundé' });
  });

  it('records nothing when a save changes nothing, and can clear optional fields', async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const { propertyId, unitId } = await createListing(landlord.access_token);

    await patchUnit(landlord.access_token, unitId, { rent_amount: 150000, description: 'Bright studio' }).expect(200);
    await patchProperty(landlord.access_token, propertyId, { city: 'Douala', name: 'Residence Test' }).expect(200);
    expect(await myChanges(landlord.access_token)).toHaveLength(0);

    const cleared = await patchUnit(landlord.access_token, unitId, { description: null, bedrooms: null }).expect(200);
    expect(cleared.body).toMatchObject({ description: null, bedrooms: null });
    const [change] = await myChanges(landlord.access_token);
    expect(change.changes).toEqual([
      { field: 'bedrooms', from: 1, to: null },
      { field: 'description', from: 'Bright studio', to: null },
    ]);
  });

  it('rejects invalid edits and edits to listings you do not own', async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const stranger = await signUp(app, fakeSms, randomPhoneNumber());
    const { propertyId, unitId } = await createListing(landlord.access_token);

    // Required fields can't be nulled or emptied; values are validated.
    expect((await patchUnit(landlord.access_token, unitId, { rent_amount: null }).expect(400)).body.error.code).toBe('VALIDATION_ERROR');
    await patchUnit(landlord.access_token, unitId, { rent_amount: -5 }).expect(400);
    await patchUnit(landlord.access_token, unitId, { currency: 'USD' }).expect(400);
    await patchProperty(landlord.access_token, propertyId, { address_line: null }).expect(400);
    await patchProperty(landlord.access_token, propertyId, { city: '' }).expect(400);
    await patchProperty(landlord.access_token, propertyId, { latitude: 999 }).expect(400);

    // Someone else's listing: 404 (doesn't reveal it exists), nothing changed or recorded.
    await patchUnit(stranger.access_token, unitId, { rent_amount: 1 }).expect(404);
    await patchProperty(stranger.access_token, propertyId, { city: 'Nowhere' }).expect(404);
    expect(await myChanges(landlord.access_token)).toHaveLength(0);
    expect(await myChanges(stranger.access_token)).toHaveLength(0);
  });

  it('flags changes made while a tenant is living there, keeps the tenancy rent unchanged, and shows the tenant what changed since they signed', async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());
    const stranger = await signUp(app, fakeSms, randomPhoneNumber());
    const { propertyId, unitId } = await createListing(landlord.access_token);

    // 1. Before anyone moves in: an ordinary edit.
    await patchUnit(landlord.access_token, unitId, { description: 'Before the tenant' }).expect(200);

    const tenancy = await request(app.getHttpServer())
      .post('/v1/tenancies')
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .send({ unit_id: unitId, tenant_id: tenant.user.id, start_date: '2026-09-01', rent_amount: 150000 })
      .expect(201);

    // 2. After they moved in: the landlord raises the listed rent and edits the property.
    await patchUnit(landlord.access_token, unitId, { rent_amount: 200000, change_note: 'Market adjustment' }).expect(200);
    await patchProperty(landlord.access_token, propertyId, { name: 'Renamed Residence' }).expect(200);

    // The landlord's history: 3 changes; two of them made while occupied.
    const all = await myChanges(landlord.access_token);
    expect(all).toHaveLength(3);
    const whileOccupied = await myChanges(landlord.access_token, '?while_occupied=true');
    expect(whileOccupied).toHaveLength(2);
    expect(whileOccupied.map((c) => c.entity_type).sort()).toEqual(['property', 'unit']);
    const rentChange = whileOccupied.find((c) => c.entity_type === 'unit')!;
    expect(rentChange.changes[0]).toEqual({ field: 'rent_amount', from: 150000, to: 200000 });
    // The pre-tenancy edit is NOT flagged.
    expect(all.find((c) => c.changes[0].to === 'Before the tenant')!.while_occupied).toBe(false);

    // Editing the unit's listed rent does not touch what the tenancy agreed.
    const tenancyNow = await request(app.getHttpServer())
      .get(`/v1/tenancies/${tenancy.body.id}`)
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .expect(200);
    expect(Number(tenancyNow.body.rent_amount)).toBe(150000);

    // The tenant sees only what changed since the tenancy was created — with
    // the landlord's note, and without the landlord's user id.
    const tenantView = await request(app.getHttpServer())
      .get(`/v1/tenancies/${tenancy.body.id}/listing-changes`)
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .expect(200);
    const seen = tenantView.body.results as Change[];
    expect(seen).toHaveLength(2);
    expect(seen.every((c) => c.while_occupied)).toBe(true);
    expect(seen.find((c) => c.entity_type === 'unit')!.note).toBe('Market adjustment');
    expect(seen.every((c) => c.changed_by === undefined)).toBe(true);

    // The landlord can see the same view; a stranger cannot.
    await request(app.getHttpServer())
      .get(`/v1/tenancies/${tenancy.body.id}/listing-changes`)
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/v1/tenancies/${tenancy.body.id}/listing-changes`)
      .set('Authorization', `Bearer ${stranger.access_token}`)
      .expect(404);
  });

  it('a change to a verified property is marked as such', async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const { propertyId } = await createListing(landlord.access_token);
    await prisma.property.update({ where: { id: propertyId }, data: { ownershipVerifiedAt: new Date() } });

    await patchProperty(landlord.access_token, propertyId, { address_line: '99 Different Street' }).expect(200);

    const [change] = await myChanges(landlord.access_token);
    expect(change.property_verified_at_change).toBe(true);
  });

  it('gives admins the full audit trail, with who made each change, filterable to changes made while occupied', async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());
    const { unitId } = await createListing(landlord.access_token);
    await patchUnit(landlord.access_token, unitId, { description: 'Vacant edit' }).expect(200);
    await request(app.getHttpServer())
      .post('/v1/tenancies')
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .send({ unit_id: unitId, tenant_id: tenant.user.id, start_date: '2026-09-01', rent_amount: 150000 })
      .expect(201);
    await patchUnit(landlord.access_token, unitId, { description: 'Occupied edit' }).expect(200);

    const adminPhone = randomPhoneNumber();
    await prisma.user.create({ data: { phoneNumber: adminPhone, roles: { create: [{ role: 'tenant' }, { role: 'admin' }] } } });
    const admin = await signUp(app, fakeSms, adminPhone);

    const everything = await request(app.getHttpServer())
      .get('/v1/admin/listing-changes')
      .set('Authorization', `Bearer ${admin.access_token}`)
      .expect(200);
    expect(everything.body.results).toHaveLength(2);
    expect(everything.body.results[0]).toMatchObject({
      changed_by: landlord.user.id,
      changed_by_profile: { phone_number: landlord.user.phone_number },
    });

    const occupiedOnly = await request(app.getHttpServer())
      .get('/v1/admin/listing-changes?while_occupied=true')
      .set('Authorization', `Bearer ${admin.access_token}`)
      .expect(200);
    expect(occupiedOnly.body.results).toHaveLength(1);
    expect(occupiedOnly.body.results[0].changes[0].to).toBe('Occupied edit');

    // Not for landlords or tenants.
    await request(app.getHttpServer())
      .get('/v1/admin/listing-changes')
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .expect(403);
  });

  it("lists a landlord's own properties with unit counts (so they can be edited after a reload)", async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const other = await signUp(app, fakeSms, randomPhoneNumber());
    const { unitId } = await createListing(landlord.access_token);
    await createListing(other.access_token);
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());
    await request(app.getHttpServer())
      .post('/v1/tenancies')
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .send({ unit_id: unitId, tenant_id: tenant.user.id, start_date: '2026-09-01', rent_amount: 150000 })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/v1/landlords/me/properties')
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ name: 'Residence Test', unit_count: 1, occupied_unit_count: 1 });
  });

  it('manages photos: pick a cover, remove one, and removing the last one un-lists a vacant unit — all recorded', async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const { unitId } = await createListing(landlord.access_token, 2);

    const mine = await request(app.getHttpServer())
      .get('/v1/landlords/me/units')
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .expect(200);
    const photos = mine.body[0].photos as { id: string; url: string; sort_order: number }[];
    expect(photos).toHaveLength(2);

    // Make the second photo the cover.
    const cover = await request(app.getHttpServer())
      .post(`/v1/units/${unitId}/photos/${photos[1].id}/cover`)
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .expect(201);
    expect(cover.body.photos.map((p: { id: string }) => p.id)).toEqual([photos[1].id, photos[0].id]);

    // Remove one; the rest is re-sequenced.
    const removed = await request(app.getHttpServer())
      .delete(`/v1/units/${unitId}/photos/${photos[1].id}`)
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .expect(200);
    expect(removed.body.photos).toEqual([{ id: photos[0].id, url: expect.any(String) as string, sort_order: 0 }]);
    expect(removed.body.unit_status).toBe('vacant');

    // Remove the last: a vacant unit with no photos goes back to draft and leaves public search.
    const search = () => request(app.getHttpServer()).get('/v1/units?city=Douala').expect(200);
    expect((await search()).body.results.some((u: { id: string }) => u.id === unitId)).toBe(true);
    const last = await request(app.getHttpServer())
      .delete(`/v1/units/${unitId}/photos/${photos[0].id}`)
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .expect(200);
    expect(last.body.unit_status).toBe('draft');
    expect((await search()).body.results.some((u: { id: string }) => u.id === unitId)).toBe(false);

    const actions = (await myChanges(landlord.access_token)).map((c) => c.action).sort();
    expect(actions).toEqual(['cover_photo_changed', 'photo_removed', 'photo_removed']);

    // Someone else's photo id / a photo not on this unit: 404.
    await request(app.getHttpServer())
      .delete(`/v1/units/${unitId}/photos/${photos[0].id}`)
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .expect(404);
  });

  it('records photos added while a tenant is living there (but not the ordinary building of a new listing)', async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());
    const { unitId } = await createListing(landlord.access_token, 2);
    // Setting up the listing (3 photo uploads incl. the first) recorded nothing.
    expect(await myChanges(landlord.access_token)).toHaveLength(0);

    await request(app.getHttpServer())
      .post('/v1/tenancies')
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .send({ unit_id: unitId, tenant_id: tenant.user.id, start_date: '2026-09-01', rent_amount: 150000 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/v1/units/${unitId}/photos`)
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .attach('file', Buffer.from('fake-image'), 'later.jpg')
      .expect(201);

    const [change] = await myChanges(landlord.access_token);
    expect(change).toMatchObject({ action: 'photo_added', while_occupied: true });
  });
});
