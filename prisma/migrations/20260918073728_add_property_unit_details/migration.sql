-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('residential', 'commercial', 'mixed_use');

-- AlterTable
ALTER TABLE "properties" ADD COLUMN     "facilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "property_type" "PropertyType";

-- AlterTable
ALTER TABLE "units" ADD COLUMN     "facilities" TEXT[] DEFAULT ARRAY[]::TEXT[];
