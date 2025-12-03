// seed.js
// Run with: node src/seed.js

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting seed...\n');

  // Clear existing data
  console.log('Clearing existing data...');
  await prisma.behaviorRecord.deleteMany();
  await prisma.behaviorCategory.deleteMany();
  await prisma.behaviorScale.deleteMany();
  await prisma.attendance.deleteMany();
  await prisma.classEnrollment.deleteMany();
  await prisma.parentStudent.deleteMany();
  await prisma.class.deleteMany();
  await prisma.student.deleteMany();
  await prisma.user.deleteMany();
  await prisma.school.deleteMany();

  // Hash password - all test users will use "password123"
  const passwordHash = await bcrypt.hash('password123', 10);

  // Create School
  console.log('Creating school...');
  const school = await prisma.school.create({
    data: {
      name: 'Erudition Demo Academy',
      subdomain: 'demo',
      email: 'admin@erudition-demo.com',
      phone: '02-1234-5678',
      address: '123 Education Street, Taipei',
      timezone: 'Asia/Taipei',
      subscriptionStatus: 'ACTIVE',
    },
  });
  console.log(`✅ Created school: ${school.name}\n`);

  // Create Users
  console.log('Creating users...');
  
  const admin = await prisma.user.create({
    data: {
      email: 'admin@test.com',
      passwordHash,
      firstName: 'Admin',
      lastName: 'User',
      role: 'ADMIN',
      schoolId: school.id,
      isActive: true,
      preferredLang: 'zh-TW',
    },
  });
  console.log(`✅ Admin: admin@test.com`);

  const manager = await prisma.user.create({
    data: {
      email: 'manager@test.com',
      passwordHash,
      firstName: 'Manager',
      lastName: 'User',
      role: 'MANAGER',
      schoolId: school.id,
      isActive: true,
      preferredLang: 'zh-TW',
    },
  });
  console.log(`✅ Manager: manager@test.com`);

  const teacher1 = await prisma.user.create({
    data: {
      email: 'teacher@test.com',
      passwordHash,
      firstName: 'Wei',
      lastName: 'Chen',
      role: 'TEACHER',
      schoolId: school.id,
      isActive: true,
      preferredLang: 'zh-TW',
    },
  });
  console.log(`✅ Teacher: teacher@test.com`);

  const teacher2 = await prisma.user.create({
    data: {
      email: 'teacher2@test.com',
      passwordHash,
      firstName: 'Mei',
      lastName: 'Lin',
      role: 'TEACHER',
      schoolId: school.id,
      isActive: true,
      preferredLang: 'zh-TW',
    },
  });
  console.log(`✅ Teacher: teacher2@test.com`);

  const parent1 = await prisma.user.create({
    data: {
      email: 'parent@test.com',
      passwordHash,
      firstName: 'Ming',
      lastName: 'Wang',
      role: 'PARENT',
      schoolId: school.id,
      isActive: true,
      preferredLang: 'zh-TW',
    },
  });
  console.log(`✅ Parent: parent@test.com`);

  const parent2 = await prisma.user.create({
    data: {
      email: 'parent2@test.com',
      passwordHash,
      firstName: 'Li',
      lastName: 'Zhang',
      role: 'PARENT',
      schoolId: school.id,
      isActive: true,
      preferredLang: 'zh-TW',
    },
  });
  console.log(`✅ Parent: parent2@test.com\n`);

  // Create Students
  console.log('Creating students...');
  const students = await Promise.all([
    prisma.student.create({
      data: { firstName: 'Xiao', lastName: 'Wang', englishName: 'Tommy', schoolId: school.id, status: 'ACTIVE' },
    }),
    prisma.student.create({
      data: { firstName: 'Mei', lastName: 'Wang', englishName: 'May', schoolId: school.id, status: 'ACTIVE' },
    }),
    prisma.student.create({
      data: { firstName: 'Jun', lastName: 'Zhang', englishName: 'Jason', schoolId: school.id, status: 'ACTIVE' },
    }),
    prisma.student.create({
      data: { firstName: 'Hua', lastName: 'Zhang', englishName: 'Flora', schoolId: school.id, status: 'ACTIVE' },
    }),
    prisma.student.create({
      data: { firstName: 'Wei', lastName: 'Liu', englishName: 'William', schoolId: school.id, status: 'ACTIVE' },
    }),
    prisma.student.create({
      data: { firstName: 'Ling', lastName: 'Chen', englishName: 'Linda', schoolId: school.id, status: 'ACTIVE' },
    }),
  ]);
  console.log(`✅ Created ${students.length} students\n`);

  // Link Parents to Students
  console.log('Linking parents to students...');
  await prisma.parentStudent.createMany({
    data: [
      { parentId: parent1.id, studentId: students[0].id, relationship: 'Father' },
      { parentId: parent1.id, studentId: students[1].id, relationship: 'Father' },
      { parentId: parent2.id, studentId: students[2].id, relationship: 'Mother' },
      { parentId: parent2.id, studentId: students[3].id, relationship: 'Mother' },
    ],
  });
  console.log(`✅ Linked parents to students\n`);

  // Create Classes (NO isActive field in Class model)
  console.log('Creating classes...');
  const class1 = await prisma.class.create({
    data: {
      name: 'Elementary English A',
      description: 'Basic English for elementary students',
      dayOfWeek: 'Monday,Wednesday',
      startTime: '16:00',
      endTime: '17:30',
      schoolId: school.id,
      teacherId: teacher1.id,
      maxStudents: 12,
    },
  });

  const class2 = await prisma.class.create({
    data: {
      name: 'Elementary Math',
      description: 'Math enrichment for elementary students',
      dayOfWeek: 'Tuesday,Thursday',
      startTime: '16:00',
      endTime: '17:30',
      schoolId: school.id,
      teacherId: teacher1.id,
      maxStudents: 10,
    },
  });

  const class3 = await prisma.class.create({
    data: {
      name: 'Junior High English',
      description: 'Intermediate English for junior high students',
      dayOfWeek: 'Monday,Wednesday,Friday',
      startTime: '18:00',
      endTime: '19:30',
      schoolId: school.id,
      teacherId: teacher2.id,
      maxStudents: 15,
    },
  });

  const class4 = await prisma.class.create({
    data: {
      name: 'Art & Creativity',
      description: 'Art and creative expression',
      dayOfWeek: 'Saturday',
      startTime: '10:00',
      endTime: '12:00',
      schoolId: school.id,
      teacherId: teacher2.id,
      maxStudents: 8,
    },
  });
  console.log(`✅ Created 4 classes\n`);

  // Enroll Students
  console.log('Enrolling students...');
  await prisma.classEnrollment.createMany({
    data: [
      { classId: class1.id, studentId: students[0].id, status: 'ACTIVE' },
      { classId: class1.id, studentId: students[2].id, status: 'ACTIVE' },
      { classId: class1.id, studentId: students[4].id, status: 'ACTIVE' },
      { classId: class1.id, studentId: students[5].id, status: 'ACTIVE' },
      { classId: class2.id, studentId: students[0].id, status: 'ACTIVE' },
      { classId: class2.id, studentId: students[2].id, status: 'ACTIVE' },
      { classId: class2.id, studentId: students[3].id, status: 'ACTIVE' },
      { classId: class3.id, studentId: students[1].id, status: 'ACTIVE' },
      { classId: class3.id, studentId: students[4].id, status: 'ACTIVE' },
      { classId: class4.id, studentId: students[1].id, status: 'ACTIVE' },
      { classId: class4.id, studentId: students[3].id, status: 'ACTIVE' },
      { classId: class4.id, studentId: students[5].id, status: 'ACTIVE' },
    ],
  });
  console.log(`✅ Enrolled students in classes\n`);

  // Create Behavior Scale
  console.log('Creating behavior tracking...');
  const behaviorScale = await prisma.behaviorScale.create({
    data: {
      name: '5-Point Scale',
      nameChinese: '五分制',
      minValue: 1,
      maxValue: 5,
      labels: { '1': 'Poor', '2': 'Needs Improvement', '3': 'Satisfactory', '4': 'Good', '5': 'Excellent' },
      labelsChinese: { '1': '待改進', '2': '尚可', '3': '良好', '4': '很好', '5': '優秀' },
      colors: { '1': '#ef4444', '2': '#f97316', '3': '#eab308', '4': '#22c55e', '5': '#10b981' },
      isDefault: true,
      isActive: true,
      schoolId: school.id,
    },
  });

  await prisma.behaviorCategory.createMany({
    data: [
      { name: 'Effort', nameChinese: '努力程度', icon: 'star', color: '#3b82f6', scaleId: behaviorScale.id, schoolId: school.id, sortOrder: 0, isActive: true },
      { name: 'Participation', nameChinese: '課堂參與', icon: 'zap', color: '#8b5cf6', scaleId: behaviorScale.id, schoolId: school.id, sortOrder: 1, isActive: true },
      { name: 'Behavior', nameChinese: '行為表現', icon: 'heart', color: '#ec4899', scaleId: behaviorScale.id, schoolId: school.id, sortOrder: 2, isActive: true },
      { name: 'Homework', nameChinese: '作業完成', icon: 'target', color: '#14b8a6', scaleId: behaviorScale.id, schoolId: school.id, sortOrder: 3, isActive: true },
    ],
  });
  console.log(`✅ Created behavior scale and categories\n`);

  // Done!
  console.log('══════════════════════════════════════════════════');
  console.log('🎉 SEED COMPLETED!\n');
  console.log('All passwords: password123\n');
  console.log('ACCOUNTS:');
  console.log('  admin@test.com      (Admin)');
  console.log('  manager@test.com    (Manager)');
  console.log('  teacher@test.com    (Teacher)');
  console.log('  teacher2@test.com   (Teacher)');
  console.log('  parent@test.com     (Parent)');
  console.log('  parent2@test.com    (Parent)');
  console.log('══════════════════════════════════════════════════');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
