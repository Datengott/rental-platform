import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaModule } from '../src/common/prisma.module';
import { StorageModule } from '../src/common/storage/storage.module';
import { AuthModule } from '../src/modules/auth/auth.module';
import { PropertiesModule } from '../src/modules/properties/properties.module';
import { configureApp } from '../src/setup-app';
import { PrismaService } from '../src/common/prisma.service';
import { SMS_GATEWAY } from '../src/modules/auth/sms/sms-gateway';
import { FakeSmsGateway, randomPhoneNumber } from './support/fake-sms-gateway';
import { signUp } from './support/sign-up';

describe('Properties module (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fakeSms: FakeSmsGateway;

  beforeAll(async () => {
    fakeSms = new FakeSmsGateway();

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        EventEmitterModule.forRoot(),
        PrismaModule,
        StorageModule,
        AuthModule,
        PropertiesModule,
      ],
    })
      .overrideProvider(SMS_GATEWAY)
      .useValue(fakeSms)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    await prisma.unitPhoto.deleteMany();
    await prisma.unit.deleteMany();
    await prisma.property.deleteMany();
    await prisma.session.deleteMany();
    await prisma.otpChallenge.deleteMany();
    await prisma.userRoleAssignment.deleteMany();
    await prisma.user.deleteMany();
  });

  async function createPropertyWithUnit(accessToken: string) {
    const propertyRes = await request(app.getHttpServer())
      .post('/v1/properties')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ address_line: '12 Rue de la Paix', city: 'Douala', region: 'Littoral' })
      .expect(201);

    const unitRes = await request(app.getHttpServer())
      .post(`/v1/properties/${propertyRes.body.id}/units`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ label: 'Unit 4B', bedrooms: 2, rent_amount: 150000 })
      .expect(201);

    return { property: propertyRes.body, unit: unitRes.body };
  }

  it('creating a property auto-grants the landlord role', async () => {
    const session = await signUp(app, fakeSms, randomPhoneNumber());

    const res = await request(app.getHttpServer())
      .post('/v1/properties')
      .set('Authorization', `Bearer ${session.access_token}`)
      .send({ name: 'Résidence Bonapriso', address_line: '12 Rue de la Paix', city: 'Douala' })
      .expect(201);

    expect(res.body).toMatchObject({
      landlord_id: session.user.id,
      city: 'Douala',
      ownership_verified_at: null,
    });

    const me = await request(app.getHttpServer())
      .get('/v1/users/me')
      .set('Authorization', `Bearer ${session.access_token}`)
      .expect(200);
    expect(me.body.roles).toEqual(expect.arrayContaining(['tenant', 'landlord']));
  });

  it('accepts optional property_type and facilities, and unit facilities, echoing them back through search', async () => {
    const session = await signUp(app, fakeSms, randomPhoneNumber());

    const propertyRes = await request(app.getHttpServer())
      .post('/v1/properties')
      .set('Authorization', `Bearer ${session.access_token}`)
      .send({
        address_line: '12 Rue de la Paix',
        city: 'Douala',
        property_type: 'residential',
        facilities: ['gated', 'generator'],
      })
      .expect(201);
    expect(propertyRes.body).toMatchObject({ property_type: 'residential', facilities: ['gated', 'generator'] });

    const unitRes = await request(app.getHttpServer())
      .post(`/v1/properties/${propertyRes.body.id}/units`)
      .set('Authorization', `Bearer ${session.access_token}`)
      .send({ bedrooms: 2, bathrooms: 1, rent_amount: 150000, facilities: ['ac', 'wifi'] })
      .expect(201);
    expect(unitRes.body.facilities).toEqual(['ac', 'wifi']);

    await request(app.getHttpServer())
      .post(`/v1/units/${unitRes.body.id}/photos`)
      .set('Authorization', `Bearer ${session.access_token}`)
      .attach('file', Buffer.from('fake-image'), 'photo.jpg')
      .expect(201);

    const search = await request(app.getHttpServer()).get('/v1/units?city=Douala').expect(200);
    const found = search.body.results.find((u: { id: string }) => u.id === unitRes.body.id);
    expect(found).toMatchObject({
      bathrooms: 1,
      facilities: ['ac', 'wifi'],
      property: { property_type: 'residential', facilities: ['gated', 'generator'] },
    });
  });

  it('creates several independent units in one call when quantity is given, auto-numbering the label', async () => {
    const session = await signUp(app, fakeSms, randomPhoneNumber());
    const propertyRes = await request(app.getHttpServer())
      .post('/v1/properties')
      .set('Authorization', `Bearer ${session.access_token}`)
      .send({ address_line: '12 Rue de la Paix', city: 'Douala' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/v1/properties/${propertyRes.body.id}/units`)
      .set('Authorization', `Bearer ${session.access_token}`)
      .send({ label: 'Studio', rent_amount: 100000, quantity: 3 })
      .expect(201);

    expect(res.body.units).toHaveLength(3);
    expect(res.body.units.map((u: { label: string }) => u.label)).toEqual(['Studio #1', 'Studio #2', 'Studio #3']);
    // Independent rows, not one row with a count — distinct ids.
    expect(new Set(res.body.units.map((u: { id: string }) => u.id)).size).toBe(3);

    const myUnits = await request(app.getHttpServer())
      .get('/v1/landlords/me/units')
      .set('Authorization', `Bearer ${session.access_token}`)
      .expect(200);
    expect(myUnits.body).toHaveLength(3);
  });

  it('omitting quantity (or sending 1) keeps the original single-object response shape', async () => {
    const session = await signUp(app, fakeSms, randomPhoneNumber());
    const propertyRes = await request(app.getHttpServer())
      .post('/v1/properties')
      .set('Authorization', `Bearer ${session.access_token}`)
      .send({ address_line: '12 Rue de la Paix', city: 'Douala' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/v1/properties/${propertyRes.body.id}/units`)
      .set('Authorization', `Bearer ${session.access_token}`)
      .send({ rent_amount: 100000, quantity: 1 })
      .expect(201);

    expect(res.body.units).toBeUndefined();
    expect(res.body.id).toBeDefined();
  });

  it('a new unit starts as draft and does not appear in search', async () => {
    const session = await signUp(app, fakeSms, randomPhoneNumber());
    const { unit } = await createPropertyWithUnit(session.access_token);

    expect(unit.status).toBe('draft');

    const search = await request(app.getHttpServer()).get('/v1/units?city=Douala').expect(200);
    expect(search.body.results.find((u: { id: string }) => u.id === unit.id)).toBeUndefined();
  });

  it('the first photo upload publishes the unit (draft -> vacant) and it becomes searchable', async () => {
    const session = await signUp(app, fakeSms, randomPhoneNumber());
    const { unit } = await createPropertyWithUnit(session.access_token);

    const photoRes = await request(app.getHttpServer())
      .post(`/v1/units/${unit.id}/photos`)
      .set('Authorization', `Bearer ${session.access_token}`)
      .attach('file', Buffer.from('fake-image-bytes'), 'photo.jpg')
      .field('geo_latitude', '4.05')
      .field('geo_longitude', '9.7')
      .expect(201);

    expect(photoRes.body).not.toHaveProperty('geo_latitude');
    expect(photoRes.body.storage_url).toContain('local://unit-photos/');

    const search = await request(app.getHttpServer()).get('/v1/units?city=Douala').expect(200);
    const found = search.body.results.find((u: { id: string }) => u.id === unit.id);
    expect(found).toMatchObject({ cover_photo_url: photoRes.body.storage_url, property: { verified: false } });
  });

  it('rejects adding a unit to a property owned by someone else with 404', async () => {
    const owner = await signUp(app, fakeSms, randomPhoneNumber());
    const { property } = await createPropertyWithUnit(owner.access_token);

    const intruder = await signUp(app, fakeSms, randomPhoneNumber());
    const res = await request(app.getHttpServer())
      .post(`/v1/properties/${property.id}/units`)
      .set('Authorization', `Bearer ${intruder.access_token}`)
      .send({ rent_amount: 50000 })
      .expect(404);

    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects an invalid manual status transition with 422', async () => {
    const session = await signUp(app, fakeSms, randomPhoneNumber());
    const { unit } = await createPropertyWithUnit(session.access_token);

    await request(app.getHttpServer())
      .post(`/v1/units/${unit.id}/photos`)
      .set('Authorization', `Bearer ${session.access_token}`)
      .attach('file', Buffer.from('fake-image-bytes'), 'photo.jpg')
      .expect(201);

    const res = await request(app.getHttpServer())
      .patch(`/v1/units/${unit.id}`)
      .set('Authorization', `Bearer ${session.access_token}`)
      .send({ status: 'occupied' })
      .expect(422);

    expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('allows the vacant -> reserved manual transition', async () => {
    const session = await signUp(app, fakeSms, randomPhoneNumber());
    const { unit } = await createPropertyWithUnit(session.access_token);

    await request(app.getHttpServer())
      .post(`/v1/units/${unit.id}/photos`)
      .set('Authorization', `Bearer ${session.access_token}`)
      .attach('file', Buffer.from('fake-image-bytes'), 'photo.jpg')
      .expect(201);

    const res = await request(app.getHttpServer())
      .patch(`/v1/units/${unit.id}`)
      .set('Authorization', `Bearer ${session.access_token}`)
      .send({ status: 'reserved' })
      .expect(200);

    expect(res.body.status).toBe('reserved');
  });

  it("lists all of the landlord's units regardless of status on /landlords/me/units", async () => {
    const session = await signUp(app, fakeSms, randomPhoneNumber());
    const { unit } = await createPropertyWithUnit(session.access_token);

    const res = await request(app.getHttpServer())
      .get('/v1/landlords/me/units')
      .set('Authorization', `Bearer ${session.access_token}`)
      .expect(200);

    expect(res.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: unit.id, status: 'draft' })]));
  });
});
