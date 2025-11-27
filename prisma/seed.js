// Database Seed Script
// Creates initial demo data for testing

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create demo school
  const school = await prisma.school.upsert({
    where: { id: 'demo-school-001' },
    update: {},
    create: {
      id: 'demo-school-001',
      name: '快樂學習補習班 Happy Learning Buxiban',
      address: '台北市大安區和平東路一段123號',
      phone: '02-2345-6789',
      email: 'contact@happylearning.tw',
      timezone: 'Asia/Taipei',
      settings: {
        language: 'zh-TW',
        currency: 'TWD',
        academicYear: '113'
      }
    }
  });

  console.log('✅ Created school:', school.name);

  // Create admin user
  const adminPassword = await bcrypt.hash('admin123', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@happylearning.tw' },
    update: {},
    create: {
      email: 'admin@happylearning.tw',
      passwordHash: adminPassword,
      firstName: '管理員',
      lastName: '王',
      role: 'ADMIN',
      schoolId: school.id,
      preferredLang: 'zh-TW'
    }
  });

  console.log('✅ Created admin:', admin.email);

  // Create teacher
  const teacherPassword = await bcrypt.hash('teacher123', 12);
  const teacher = await prisma.user.upsert({
    where: { email: 'teacher@happylearning.tw' },
    update: {},
    create: {
      email: 'teacher@happylearning.tw',
      passwordHash: teacherPassword,
      firstName: '美玲',
      lastName: '李',
      role: 'TEACHER',
      schoolId: school.id,
      preferredLang: 'zh-TW',
      phone: '0912-345-678'
    }
  });

  console.log('✅ Created teacher:', teacher.email);

  // Create parent
  const parentPassword = await bcrypt.hash('parent123', 12);
  const parent = await prisma.user.upsert({
    where: { email: 'parent@example.com' },
    update: {},
    create: {
      email: 'parent@example.com',
      passwordHash: parentPassword,
      firstName: '小明媽媽',
      lastName: '陳',
      role: 'PARENT',
      schoolId: school.id,
      preferredLang: 'zh-TW',
      phone: '0923-456-789'
    }
  });

  console.log('✅ Created parent:', parent.email);

  // Create students
  const student1 = await prisma.student.upsert({
    where: { id: 'student-001' },
    update: {},
    create: {
      id: 'student-001',
      firstName: '小明',
      lastName: '陳',
      englishName: 'David Chen',
      dateOfBirth: new Date('2015-03-15'),
      gender: 'male',
      schoolId: school.id,
      emergencyContactName: '陳媽媽',
      emergencyContactPhone: '0923-456-789',
      emergencyContactRelation: 'mother',
      status: 'ACTIVE'
    }
  });

  const student2 = await prisma.student.upsert({
    where: { id: 'student-002' },
    update: {},
    create: {
      id: 'student-002',
      firstName: '小華',
      lastName: '林',
      englishName: 'Amy Lin',
      dateOfBirth: new Date('2014-08-22'),
      gender: 'female',
      schoolId: school.id,
      emergencyContactName: '林爸爸',
      emergencyContactPhone: '0934-567-890',
      emergencyContactRelation: 'father',
      status: 'ACTIVE'
    }
  });

  console.log('✅ Created students:', student1.firstName, student2.firstName);

  // Link parent to student
  await prisma.parentStudent.upsert({
    where: {
      parentId_studentId: {
        parentId: parent.id,
        studentId: student1.id
      }
    },
    update: {},
    create: {
      parentId: parent.id,
      studentId: student1.id,
      relationship: 'mother',
      isPrimary: true
    }
  });

  console.log('✅ Linked parent to student');

  // Create classes
  const englishClass = await prisma.class.upsert({
    where: { id: 'class-english-001' },
    update: {},
    create: {
      id: 'class-english-001',
      name: '國小英文班 Elementary English',
      description: '適合國小3-6年級學生的英文課程',
      schoolId: school.id,
      teacherId: teacher.id,
      dayOfWeek: 'Monday,Wednesday,Friday',
      startTime: '16:30',
      endTime: '18:00',
      maxStudents: 15,
      academicYear: '113',
      term: '上學期'
    }
  });

  const mathClass = await prisma.class.upsert({
    where: { id: 'class-math-001' },
    update: {},
    create: {
      id: 'class-math-001',
      name: '國小數學班 Elementary Math',
      description: '適合國小3-6年級學生的數學課程',
      schoolId: school.id,
      teacherId: teacher.id,
      dayOfWeek: 'Tuesday,Thursday',
      startTime: '16:30',
      endTime: '18:00',
      maxStudents: 12,
      academicYear: '113',
      term: '上學期'
    }
  });

  console.log('✅ Created classes:', englishClass.name, mathClass.name);

  // Enroll students in classes
  await prisma.classEnrollment.upsert({
    where: {
      classId_studentId: {
        classId: englishClass.id,
        studentId: student1.id
      }
    },
    update: {},
    create: {
      classId: englishClass.id,
      studentId: student1.id,
      status: 'ACTIVE'
    }
  });

  await prisma.classEnrollment.upsert({
    where: {
      classId_studentId: {
        classId: englishClass.id,
        studentId: student2.id
      }
    },
    update: {},
    create: {
      classId: englishClass.id,
      studentId: student2.id,
      status: 'ACTIVE'
    }
  });

  await prisma.classEnrollment.upsert({
    where: {
      classId_studentId: {
        classId: mathClass.id,
        studentId: student1.id
      }
    },
    update: {},
    create: {
      classId: mathClass.id,
      studentId: student1.id,
      status: 'ACTIVE'
    }
  });

  console.log('✅ Enrolled students in classes');

  // Create sample homework
  const homework = await prisma.homework.create({
    data: {
      title: '英文單字練習 Vocabulary Practice',
      description: '完成課本第三單元單字練習，並造句五句。\nComplete vocabulary exercises from Unit 3 and write 5 sentences.',
      classId: englishClass.id,
      createdById: teacher.id,
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 1 week from now
      maxScore: 100,
      allowLateSubmission: true
    }
  });

  console.log('✅ Created homework:', homework.title);

  // Create sample attendance records
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  await prisma.attendance.createMany({
    data: [
      {
        classId: englishClass.id,
        studentId: student1.id,
        date: today,
        status: 'PRESENT',
        markedById: teacher.id
      },
      {
        classId: englishClass.id,
        studentId: student2.id,
        date: today,
        status: 'PRESENT',
        markedById: teacher.id
      }
    ],
    skipDuplicates: true
  });

  console.log('✅ Created attendance records');

  console.log('\n🎉 Database seeded successfully!\n');
  console.log('Demo Accounts:');
  console.log('─────────────────────────────────');
  console.log('Admin:   admin@happylearning.tw / admin123');
  console.log('Teacher: teacher@happylearning.tw / teacher123');
  console.log('Parent:  parent@example.com / parent123');
  console.log('─────────────────────────────────\n');
}

main()
  .catch((e) => {
    console.error('❌ Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
