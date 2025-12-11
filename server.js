const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const { OAuth2Client } = require('google-auth-library');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Initialize Google OAuth client
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increase limit for file uploads
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Routes
app.get('/', (req, res) => {
  res.json({ message: 'Math Mates API Server with Supabase' });
});

// Register
app.post('/api/auth/register', async (req, res) => {
  const startTime = Date.now();
  console.log('[REGISTER] Starting registration...');
  
  try {
    const { email, password, name, role } = req.body;
    console.log(`[REGISTER] Request for: ${email}, role: ${role}`);

    // Validate input
    if (!email || !password || !name || !role) {
      console.log('[REGISTER] Validation failed: Missing fields');
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (!['student', 'teacher', 'parent'].includes(role)) {
      console.log('[REGISTER] Validation failed: Invalid role');
      return res.status(400).json({ error: 'Invalid role' });
    }

    // Check if user exists
    console.log('[REGISTER] Checking if user exists...');
    const { data: existingUser } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (existingUser) {
      console.log('[REGISTER] User already exists');
      return res.status(400).json({ error: 'Email already exists' });
    }
    console.log('[REGISTER] User does not exist, proceeding...');

    // Hash password
    console.log('[REGISTER] Hashing password...');
    const hashedPassword = await bcrypt.hash(password, 10);
    console.log('[REGISTER] Password hashed');

    // Insert user
    console.log('[REGISTER] Creating user record...');
    const { data: newUser, error: userError } = await supabase
      .from('users')
      .insert([
        {
          email,
          password: hashedPassword,
          name,
          role,
          is_new_user: true
        }
      ])
      .select()
      .single();

    if (userError) {
      console.error('[REGISTER] User creation error:', userError);
      return res.status(500).json({ error: 'Failed to create user' });
    }
    console.log(`[REGISTER] User created with ID: ${newUser.id}`);

    // Create role-specific record
    console.log(`[REGISTER] Creating ${role} record...`);
    if (role === 'teacher') {
      await supabase.from('teachers').insert([{ user_id: newUser.id }]);
    } else if (role === 'student') {
      // Get next sequence number
      const { data: seqData, error: seqError } = await supabase
        .rpc('get_next_student_number');
      
      let studentSequence = 1;
      if (!seqError && seqData) {
        studentSequence = seqData;
      } else {
        // Fallback: get max sequence + 1
        const { data: maxStudent } = await supabase
          .from('students')
          .select('student_sequence')
          .order('student_sequence', { ascending: false })
          .limit(1)
          .single();
        
        studentSequence = (maxStudent?.student_sequence || 0) + 1;
      }
      
      const studentNumber = `STU-${String(studentSequence).padStart(4, '0')}`;
      await supabase.from('students').insert([
        { 
          user_id: newUser.id, 
          student_number: studentNumber,
          student_sequence: studentSequence
        }
      ]);
    } else if (role === 'parent') {
      await supabase.from('parents').insert([{ user_id: newUser.id }]);
    }
    console.log(`[REGISTER] ${role} record created`);

    // Generate token
    console.log('[REGISTER] Generating JWT token...');
    const token = jwt.sign(
      { userId: newUser.id, email: newUser.email, role: newUser.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    const duration = Date.now() - startTime;
    console.log(`[REGISTER] Registration completed in ${duration}ms`);

    res.status(201).json({
      message: 'User created successfully',
      token,
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        role: newUser.role,
        isNewUser: true
      }
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[REGISTER] Error after ${duration}ms:`, error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const startTime = Date.now();
  console.log('[LOGIN] Starting login...');
  
  try {
    const { email, password } = req.body;
    console.log(`[LOGIN] Request for: ${email}`);

    // Validate input
    if (!email || !password) {
      console.log('[LOGIN] Validation failed: Missing credentials');
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user
    console.log('[LOGIN] Finding user...');
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (userError || !user) {
      console.log('[LOGIN] User not found');
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    console.log(`[LOGIN] User found: ${user.id}, role: ${user.role}`);

    // Check password
    console.log('[LOGIN] Verifying password...');
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      console.log('[LOGIN] Invalid password');
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    console.log('[LOGIN] Password verified');

    // Generate token
    console.log('[LOGIN] Generating JWT token...');
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    console.log('[LOGIN] Token generated');

    // Get role-specific data
    console.log('[LOGIN] Fetching role-specific data...');
    let userData = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isNewUser: user.is_new_user
    };

    if (user.role === 'student') {
      console.log('[LOGIN] Fetching student data...');
      const { data: student } = await supabase
        .from('students')
        .select('*')
        .eq('user_id', user.id)
        .single();

      userData.studentNumber = student?.student_number;
      userData.grade = student?.grade;
      console.log(`[LOGIN] Student data: grade=${student?.grade}`);

      // Get enrolled classes
      console.log('[LOGIN] Fetching enrolled classes...');
      const { data: enrollments } = await supabase
        .from('enrollments')
        .select(`
          *,
          classes (
            *,
            teachers (
              users (name)
            )
          )
        `)
        .eq('student_id', student?.id);

      userData.enrolledClasses = enrollments?.map(e => ({
        id: e.classes.id,
        classCode: e.classes.class_code,
        className: e.classes.class_name,
        teacher: e.classes.teachers.users.name,
        subject: e.classes.subject,
        grade: e.classes.grade,
        progress: e.progress
      })) || [];
      console.log(`[LOGIN] Found ${userData.enrolledClasses.length} enrolled classes`);
    } else if (user.role === 'teacher') {
      const { data: teacher } = await supabase
        .from('teachers')
        .select('*')
        .eq('user_id', user.id)
        .single();

      // Get classes
      const { data: classes } = await supabase
        .from('classes')
        .select('*')
        .eq('teacher_id', teacher?.id);

      userData.classes = classes?.map(c => ({
        id: c.id,
        classCode: c.class_code,
        className: c.class_name,
        subject: c.subject,
        grade: c.grade,
        students: [],
        announcements: [],
        activities: []
      })) || [];
    } else if (user.role === 'parent') {
      const { data: parent } = await supabase
        .from('parents')
        .select('*')
        .eq('user_id', user.id)
        .single();

      // Get linked students
      const { data: links } = await supabase
        .from('parent_student_links')
        .select(`
          *,
          students (
            *,
            users (name, email)
          )
        `)
        .eq('parent_id', parent?.id);

      // Get enrollments and classes for each student
      const studentsWithDetails = await Promise.all(
        (links || []).map(async (link) => {
          const student = link.students;
          
          const { data: enrollments } = await supabase
            .from('enrollments')
            .select(`
              class_id,
              classes (
                class_name,
                subject,
                teacher_id,
                teachers (
                  user_id,
                  users (name)
                )
              )
            `)
            .eq('student_id', student.id);

          const classes = enrollments?.map(e => e.classes.class_name) || [];
          const teacherName = enrollments?.[0]?.classes?.teachers?.users?.name || 'No teacher assigned';

          return {
            id: student.id,
            studentNumber: student.student_number,
            name: student.users.name,
            grade: student.grade,
            teacher: teacherName,
            classes
          };
        })
      );

      userData.linkedStudents = studentsWithDetails;
    }

    const duration = Date.now() - startTime;
    console.log(`[LOGIN] Login completed in ${duration}ms`);
    
    res.json({ token, user: userData });
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[LOGIN] Error after ${duration}ms:`, error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Google OAuth Login
app.post('/api/auth/google', async (req, res) => {
  const startTime = Date.now();
  console.log('[GOOGLE-AUTH] Starting Google authentication...');
  
  try {
    const { credential, role } = req.body;
    console.log(`[GOOGLE-AUTH] Request with role: ${role}`);

    if (!credential) {
      console.log('[GOOGLE-AUTH] Missing credential');
      return res.status(400).json({ error: 'Google credential is required' });
    }

    // Verify Google token
    console.log('[GOOGLE-AUTH] Verifying Google token...');
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const { email, name, sub: googleId } = payload;
    console.log(`[GOOGLE-AUTH] Token verified for: ${email}`);

    // Check if user exists
    let { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (!user) {
      // New user - role is required
      if (!role || !['student', 'teacher', 'parent'].includes(role)) {
        console.log('[GOOGLE-AUTH] Invalid role for new user');
        return res.status(400).json({ error: 'Valid role is required for new user' });
      }

      // Create new user
      console.log('[GOOGLE-AUTH] Creating new user...');
      const { data: newUser, error: userError } = await supabase
        .from('users')
        .insert([
          {
            email,
            password: '', // No password for Google OAuth users
            name,
            role,
            google_id: googleId,
            is_new_user: true
          }
        ])
        .select()
        .single();

      if (userError) {
        console.error('[GOOGLE-AUTH] User creation error:', userError);
        return res.status(500).json({ error: 'Failed to create user' });
      }

      user = newUser;
      console.log(`[GOOGLE-AUTH] User created with ID: ${user.id}`);

      // Create role-specific record
      if (role === 'teacher') {
        await supabase.from('teachers').insert([{ user_id: user.id }]);
      } else if (role === 'student') {
        const { data: seqData } = await supabase.rpc('get_next_student_number');
        let studentSequence = seqData || 1;
        const studentNumber = `STU-${String(studentSequence).padStart(4, '0')}`;
        await supabase.from('students').insert([
          { 
            user_id: user.id, 
            student_number: studentNumber,
            student_sequence: studentSequence
          }
        ]);
      } else if (role === 'parent') {
        await supabase.from('parents').insert([{ user_id: user.id }]);
      }
    } else {
      // Existing user - use their existing role
      console.log(`[GOOGLE-AUTH] Existing user found with role: ${user.role}`);
      
      // Update google_id if not set
      if (!user.google_id) {
        await supabase
          .from('users')
          .update({ google_id: googleId })
          .eq('id', user.id);
      }
    }

    // Generate token
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Get role-specific data (same as login)
    let userData = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isNewUser: user.is_new_user
    };

    if (user.role === 'student') {
      const { data: student } = await supabase
        .from('students')
        .select('*')
        .eq('user_id', user.id)
        .single();

      userData.studentNumber = student?.student_number;
      userData.grade = student?.grade;

      const { data: enrollments } = await supabase
        .from('enrollments')
        .select(`
          *,
          classes (
            *,
            teachers (
              users (name)
            )
          )
        `)
        .eq('student_id', student?.id);

      userData.enrolledClasses = enrollments?.map(e => ({
        id: e.classes.id,
        classCode: e.classes.class_code,
        className: e.classes.class_name,
        teacher: e.classes.teachers.users.name,
        subject: e.classes.subject,
        grade: e.classes.grade,
        progress: e.progress
      })) || [];
    } else if (user.role === 'teacher') {
      const { data: teacher } = await supabase
        .from('teachers')
        .select('*')
        .eq('user_id', user.id)
        .single();

      const { data: classes } = await supabase
        .from('classes')
        .select('*')
        .eq('teacher_id', teacher?.id);

      userData.classes = classes?.map(c => ({
        id: c.id,
        classCode: c.class_code,
        className: c.class_name,
        subject: c.subject,
        grade: c.grade,
        students: [],
        announcements: [],
        activities: []
      })) || [];
    } else if (user.role === 'parent') {
      const { data: parent } = await supabase
        .from('parents')
        .select('*')
        .eq('user_id', user.id)
        .single();

      const { data: links } = await supabase
        .from('parent_student_links')
        .select(`
          *,
          students (
            *,
            users (name, email)
          )
        `)
        .eq('parent_id', parent?.id);

      const studentsWithDetails = await Promise.all(
        (links || []).map(async (link) => {
          const student = link.students;
          
          const { data: enrollments } = await supabase
            .from('enrollments')
            .select(`
              class_id,
              classes (
                class_name,
                subject,
                teacher_id,
                teachers (
                  user_id,
                  users (name)
                )
              )
            `)
            .eq('student_id', student.id);

          const classes = enrollments?.map(e => e.classes.class_name) || [];
          const teacherName = enrollments?.[0]?.classes?.teachers?.users?.name || 'No teacher assigned';

          return {
            id: student.id,
            studentNumber: student.student_number,
            name: student.users.name,
            grade: student.grade,
            teacher: teacherName,
            classes
          };
        })
      );

      userData.linkedStudents = studentsWithDetails;
    }

    const duration = Date.now() - startTime;
    console.log(`[GOOGLE-AUTH] Authentication completed in ${duration}ms`);

    res.json({ token, user: userData });
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[GOOGLE-AUTH] Error after ${duration}ms:`, error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// Facebook OAuth Login
app.post('/api/auth/facebook', async (req, res) => {
  const startTime = Date.now();
  console.log('[FACEBOOK-AUTH] Starting Facebook authentication...');
  
  try {
    const { accessToken, userID, role } = req.body;
    console.log(`[FACEBOOK-AUTH] Request with role: ${role}`);

    if (!accessToken || !userID) {
      console.log('[FACEBOOK-AUTH] Missing credentials');
      return res.status(400).json({ error: 'Facebook access token and user ID are required' });
    }

    // Verify Facebook token by fetching user data
    console.log('[FACEBOOK-AUTH] Verifying Facebook token...');
    const fbResponse = await fetch(`https://graph.facebook.com/me?fields=id,name,email&access_token=${accessToken}`);
    const fbData = await fbResponse.json();

    if (fbData.error || fbData.id !== userID) {
      console.log('[FACEBOOK-AUTH] Invalid Facebook token');
      return res.status(401).json({ error: 'Invalid Facebook credentials' });
    }

    const { email, name, id: facebookId } = fbData;
    console.log(`[FACEBOOK-AUTH] Token verified for: ${email}`);

    // Check if user exists
    let { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (!user) {
      // New user - role is required
      if (!role || !['student', 'teacher', 'parent'].includes(role)) {
        console.log('[FACEBOOK-AUTH] Invalid role for new user');
        return res.status(400).json({ error: 'Valid role is required for new user' });
      }

      // Create new user
      console.log('[FACEBOOK-AUTH] Creating new user...');
      const { data: newUser, error: userError } = await supabase
        .from('users')
        .insert([
          {
            email,
            password: '', // No password for Facebook OAuth users
            name,
            role,
            facebook_id: facebookId,
            is_new_user: true
          }
        ])
        .select()
        .single();

      if (userError) {
        console.error('[FACEBOOK-AUTH] User creation error:', userError);
        return res.status(500).json({ error: 'Failed to create user' });
      }

      user = newUser;
      console.log(`[FACEBOOK-AUTH] User created with ID: ${user.id}`);

      // Create role-specific record
      if (role === 'teacher') {
        await supabase.from('teachers').insert([{ user_id: user.id }]);
      } else if (role === 'student') {
        const { data: seqData } = await supabase.rpc('get_next_student_number');
        let studentSequence = seqData || 1;
        const studentNumber = `STU-${String(studentSequence).padStart(4, '0')}`;
        await supabase.from('students').insert([
          { 
            user_id: user.id, 
            student_number: studentNumber,
            student_sequence: studentSequence
          }
        ]);
      } else if (role === 'parent') {
        await supabase.from('parents').insert([{ user_id: user.id }]);
      }
    } else {
      // Existing user - use their existing role
      console.log(`[FACEBOOK-AUTH] Existing user found with role: ${user.role}`);
      
      // Update facebook_id if not set
      if (!user.facebook_id) {
        await supabase
          .from('users')
          .update({ facebook_id: facebookId })
          .eq('id', user.id);
      }
    }

    // Generate token
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Get role-specific data (same as login)
    let userData = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isNewUser: user.is_new_user
    };

    if (user.role === 'student') {
      const { data: student } = await supabase
        .from('students')
        .select('*')
        .eq('user_id', user.id)
        .single();

      userData.studentNumber = student?.student_number;
      userData.grade = student?.grade;

      const { data: enrollments } = await supabase
        .from('enrollments')
        .select(`
          *,
          classes (
            *,
            teachers (
              users (name)
            )
          )
        `)
        .eq('student_id', student?.id);

      userData.enrolledClasses = enrollments?.map(e => ({
        id: e.classes.id,
        classCode: e.classes.class_code,
        className: e.classes.class_name,
        teacher: e.classes.teachers.users.name,
        subject: e.classes.subject,
        grade: e.classes.grade,
        progress: e.progress
      })) || [];
    } else if (user.role === 'teacher') {
      const { data: teacher } = await supabase
        .from('teachers')
        .select('*')
        .eq('user_id', user.id)
        .single();

      const { data: classes } = await supabase
        .from('classes')
        .select('*')
        .eq('teacher_id', teacher?.id);

      userData.classes = classes?.map(c => ({
        id: c.id,
        classCode: c.class_code,
        className: c.class_name,
        subject: c.subject,
        grade: c.grade,
        students: [],
        announcements: [],
        activities: []
      })) || [];
    } else if (user.role === 'parent') {
      const { data: parent } = await supabase
        .from('parents')
        .select('*')
        .eq('user_id', user.id)
        .single();

      const { data: links } = await supabase
        .from('parent_student_links')
        .select(`
          *,
          students (
            *,
            users (name, email)
          )
        `)
        .eq('parent_id', parent?.id);

      const studentsWithDetails = await Promise.all(
        (links || []).map(async (link) => {
          const student = link.students;
          
          const { data: enrollments } = await supabase
            .from('enrollments')
            .select(`
              class_id,
              classes (
                class_name,
                subject,
                teacher_id,
                teachers (
                  user_id,
                  users (name)
                )
              )
            `)
            .eq('student_id', student.id);

          const classes = enrollments?.map(e => e.classes.class_name) || [];
          const teacherName = enrollments?.[0]?.classes?.teachers?.users?.name || 'No teacher assigned';

          return {
            id: student.id,
            studentNumber: student.student_number,
            name: student.users.name,
            grade: student.grade,
            teacher: teacherName,
            classes
          };
        })
      );

      userData.linkedStudents = studentsWithDetails;
    }

    const duration = Date.now() - startTime;
    console.log(`[FACEBOOK-AUTH] Authentication completed in ${duration}ms`);

    res.json({ token, user: userData });
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[FACEBOOK-AUTH] Error after ${duration}ms:`, error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// Get user profile
app.get('/api/auth/profile', authenticateToken, async (req, res) => {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('id', req.user.userId)
      .single();

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    let userData = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isNewUser: user.is_new_user
    };

    // Add role-specific data (same as login)
    if (user.role === 'student') {
      const { data: student } = await supabase
        .from('students')
        .select('*')
        .eq('user_id', user.id)
        .single();

      userData.studentNumber = student?.student_number;
      userData.grade = student?.grade;

      // Get enrolled classes
      const { data: enrollments } = await supabase
        .from('enrollments')
        .select(`
          *,
          classes (
            *,
            teachers (
              users (name)
            )
          )
        `)
        .eq('student_id', student?.id);

      userData.enrolledClasses = enrollments?.map(e => ({
        id: e.classes.id,
        classCode: e.classes.class_code,
        className: e.classes.class_name,
        teacher: e.classes.teachers.users.name,
        subject: e.classes.subject,
        grade: e.classes.grade,
        progress: e.progress
      })) || [];
    } else if (user.role === 'teacher') {
      const { data: teacher } = await supabase
        .from('teachers')
        .select('*')
        .eq('user_id', user.id)
        .single();

      // Get classes
      const { data: classes } = await supabase
        .from('classes')
        .select('*')
        .eq('teacher_id', teacher?.id);

      userData.classes = classes?.map(c => ({
        id: c.id,
        classCode: c.class_code,
        className: c.class_name,
        subject: c.subject,
        grade: c.grade,
        students: [],
        announcements: [],
        activities: []
      })) || [];
    } else if (user.role === 'parent') {
      const { data: parent } = await supabase
        .from('parents')
        .select('*')
        .eq('user_id', user.id)
        .single();

      // Get linked students
      const { data: links } = await supabase
        .from('parent_student_links')
        .select(`
          *,
          students (
            *,
            users (name, email)
          )
        `)
        .eq('parent_id', parent?.id);

      // Get enrollments and classes for each student
      const studentsWithDetails = await Promise.all(
        (links || []).map(async (link) => {
          const student = link.students;
          
          const { data: enrollments } = await supabase
            .from('enrollments')
            .select(`
              class_id,
              classes (
                class_name,
                subject,
                teacher_id,
                teachers (
                  user_id,
                  users (name)
                )
              )
            `)
            .eq('student_id', student.id);

          const classes = enrollments?.map(e => e.classes.class_name) || [];
          const teacherName = enrollments?.[0]?.classes?.teachers?.users?.name || 'No teacher assigned';

          return {
            id: student.id,
            studentNumber: student.student_number,
            name: student.users.name,
            grade: student.grade,
            teacher: teacherName,
            classes
          };
        })
      );

      userData.linkedStudents = studentsWithDetails;
    }

    res.json({ user: userData });
  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Helper function to generate unique class code
function generateClassCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// ============================================
// PARENT ENDPOINTS
// ============================================

// Link parent to student
app.post('/api/parent/link-student', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'parent') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { studentNumber } = req.body;
    console.log('[LINK-STUDENT] Request received:', { studentNumber, userId: req.user.userId });

    if (!studentNumber) {
      return res.status(400).json({ error: 'Student number is required' });
    }

    // Normalize student number (uppercase and handle with/without dash)
    let normalizedInput = studentNumber.toUpperCase().trim();
    
    // Ensure format is STU-XXXX (add dash if missing)
    if (normalizedInput.startsWith('STU') && !normalizedInput.includes('-')) {
      normalizedInput = 'STU-' + normalizedInput.substring(3);
    }
    
    console.log('[LINK-STUDENT] Searching for student:', normalizedInput);
    
    // Find the student by student number (exact match, case-insensitive)
    const { data: student, error: studentError } = await supabase
      .from('students')
      .select('id, user_id, student_number, grade')
      .ilike('student_number', normalizedInput)
      .maybeSingle();

    console.log('[LINK-STUDENT] Student search result:', { student, error: studentError });

    if (studentError || !student) {
      console.error('[LINK-STUDENT] Student not found:', studentError);
      return res.status(404).json({ error: 'Student not found' });
    }

    // Get parent record
    console.log('[LINK-STUDENT] Looking for parent with user_id:', req.user.userId);
    const { data: parent, error: parentError } = await supabase
      .from('parents')
      .select('id')
      .eq('user_id', req.user.userId)
      .single();

    console.log('[LINK-STUDENT] Parent search result:', { parent, error: parentError });

    if (parentError || !parent) {
      console.error('[LINK-STUDENT] Parent not found:', parentError);
      return res.status(404).json({ error: 'Parent not found' });
    }

    // Check if link already exists
    const { data: existingLink } = await supabase
      .from('parent_student_links')
      .select('id')
      .eq('parent_id', parent.id)
      .eq('student_id', student.id)
      .single();

    if (existingLink) {
      return res.status(400).json({ error: 'Student already linked' });
    }

    // Create the link
    const { error: linkError } = await supabase
      .from('parent_student_links')
      .insert({
        parent_id: parent.id,
        student_id: student.id
      });

    if (linkError) {
      console.error('Error linking student:', linkError);
      return res.status(500).json({ error: 'Failed to link student' });
    }

    // Get student details with user info
    const { data: studentUser, error: userError } = await supabase
      .from('users')
      .select('name, email')
      .eq('id', student.user_id)
      .single();

    if (userError) {
      console.error('Error fetching student user:', userError);
      return res.status(500).json({ error: 'Failed to fetch student details' });
    }

    // Get student's enrolled classes
    const { data: enrollments, error: enrollError } = await supabase
      .from('enrollments')
      .select(`
        class_id,
        classes (
          class_name,
          subject,
          teacher_id,
          teachers (
            user_id,
            users (name)
          )
        )
      `)
      .eq('student_id', student.id);

    if (enrollError) {
      console.error('Error fetching enrollments:', enrollError);
    }

    const classes = enrollments?.map(e => e.classes.class_name) || [];
    const teacherName = enrollments?.[0]?.classes?.teachers?.users?.name || 'No teacher assigned';

    res.json({
      success: true,
      student: {
        id: student.id,
        studentNumber: student.student_number,
        name: studentUser.name,
        grade: student.grade,
        teacher: teacherName,
        classes
      }
    });
  } catch (error) {
    console.error('Error linking student:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get linked students for a parent
app.get('/api/parent/linked-students', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'parent') {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get parent record
    const { data: parent, error: parentError } = await supabase
      .from('parents')
      .select('id')
      .eq('user_id', req.user.userId)
      .single();

    if (parentError || !parent) {
      return res.status(404).json({ error: 'Parent not found' });
    }

    // Get linked students
    const { data: links, error: linksError } = await supabase
      .from('parent_student_links')
      .select(`
        student_id,
        students (
          id,
          student_number,
          grade,
          user_id,
          users (name, email)
        )
      `)
      .eq('parent_id', parent.id);

    if (linksError) {
      console.error('Error fetching linked students:', linksError);
      return res.status(500).json({ error: 'Failed to fetch linked students' });
    }

    // Get enrollments and classes for each student
    const studentsWithDetails = await Promise.all(
      (links || []).map(async (link) => {
        const student = link.students;
        
        // Get student's enrolled classes
        const { data: enrollments, error: enrollError } = await supabase
          .from('enrollments')
          .select(`
            class_id,
            classes (
              class_name,
              subject,
              teacher_id,
              teachers (
                user_id,
                users (name)
              )
            )
          `)
          .eq('student_id', student.id);

        if (enrollError) {
          console.error('Error fetching enrollments:', enrollError);
        }

        const classes = enrollments?.map(e => e.classes.class_name) || [];
        const teacherName = enrollments?.[0]?.classes?.teachers?.users?.name || 'No teacher assigned';

        return {
          id: student.id,
          studentNumber: student.student_number,
          name: student.users.name,
          grade: student.grade,
          teacher: teacherName,
          classes
        };
      })
    );

    res.json({ linkedStudents: studentsWithDetails });
  } catch (error) {
    console.error('Error fetching linked students:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get student progress data for parent
app.get('/api/parent/student-progress/:studentId', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'parent') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { studentId } = req.params;

    // Verify parent has access to this student
    const { data: parent } = await supabase
      .from('parents')
      .select('id')
      .eq('user_id', req.user.userId)
      .single();

    if (!parent) {
      return res.status(404).json({ error: 'Parent not found' });
    }

    const { data: link } = await supabase
      .from('parent_student_links')
      .select('id')
      .eq('parent_id', parent.id)
      .eq('student_id', studentId)
      .single();

    if (!link) {
      return res.status(403).json({ error: 'Access denied to this student' });
    }

    // Get quiz submissions with scores
    const { data: quizSubmissions } = await supabase
      .from('quiz_submissions')
      .select(`
        score,
        submitted_at,
        quizzes (
          title,
          grade
        )
      `)
      .eq('student_id', studentId)
      .order('submitted_at', { ascending: false })
      .limit(10);

    // Get lesson completions
    const { data: lessonCompletions } = await supabase
      .from('lesson_completions')
      .select(`
        stars,
        completed_at,
        lessons (
          title,
          grade
        )
      `)
      .eq('student_id', studentId)
      .order('completed_at', { ascending: false })
      .limit(10);

    // Get enrollment progress
    const { data: enrollments } = await supabase
      .from('enrollments')
      .select(`
        progress,
        classes (
          class_name,
          subject,
          grade
        )
      `)
      .eq('student_id', studentId);

    // Calculate statistics
    const averageScore = quizSubmissions?.length > 0
      ? Math.round(quizSubmissions.reduce((sum, sub) => sum + (sub.score || 0), 0) / quizSubmissions.length)
      : 0;

    const totalLessons = lessonCompletions?.length || 0;
    const averageStars = lessonCompletions?.length > 0
      ? (lessonCompletions.reduce((sum, lc) => sum + (lc.stars || 0), 0) / lessonCompletions.length).toFixed(1)
      : 0;

    // Format recent activities (combine quizzes and lessons)
    const recentActivities = [
      ...(quizSubmissions || []).map(sub => ({
        type: 'quiz',
        title: sub.quizzes?.title || 'Quiz',
        score: sub.score,
        date: new Date(sub.submitted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      })),
      ...(lessonCompletions || []).map(lc => ({
        type: 'lesson',
        title: lc.lessons?.title || 'Lesson',
        stars: lc.stars,
        date: new Date(lc.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      }))
    ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10);

    res.json({
      stats: {
        averageScore,
        totalLessons,
        averageStars,
        totalQuizzes: quizSubmissions?.length || 0
      },
      recentActivities,
      enrollments: enrollments?.map(e => ({
        className: e.classes.class_name,
        subject: e.classes.subject,
        grade: e.classes.grade,
        progress: e.progress || 0
      })) || []
    });
  } catch (error) {
    console.error('Error fetching student progress:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// TEACHER ENDPOINTS
// ============================================

// Get teacher dashboard data
app.get('/api/teacher/dashboard', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get teacher record
    const { data: teacher } = await supabase
      .from('teachers')
      .select('*')
      .eq('user_id', req.user.userId)
      .single();

    if (!teacher) {
      return res.status(404).json({ error: 'Teacher not found' });
    }

    // Get classes with student count
    const { data: classes } = await supabase
      .from('classes')
      .select(`
        *,
        enrollments (count)
      `)
      .eq('teacher_id', teacher.id);

    // Get recent lessons with files
    const { data: lessons } = await supabase
      .from('lessons')
      .select(`
        *,
        lesson_files (*)
      `)
      .eq('teacher_id', teacher.id)
      .order('created_at', { ascending: false })
      .limit(5);

    // Get all students across all classes with their progress
    const { data: allEnrollments } = await supabase
      .from('enrollments')
      .select(`
        *,
        students (
          *,
          users (name, email)
        ),
        classes (
          id,
          class_name,
          teacher_id
        )
      `)
      .eq('classes.teacher_id', teacher.id);

    // Calculate statistics
    const totalStudents = allEnrollments?.length || 0;
    const totalClasses = classes?.length || 0;
    
    // Calculate average score from quiz submissions
    const { data: quizSubmissions } = await supabase
      .from('quiz_submissions')
      .select(`
        score,
        quizzes!inner (
          teacher_id
        )
      `)
      .eq('quizzes.teacher_id', teacher.id);

    const averageScore = quizSubmissions?.length > 0
      ? Math.round(quizSubmissions.reduce((sum, sub) => sum + (sub.score || 0), 0) / quizSubmissions.length)
      : 0;

    // Get upcoming quizzes
    const { data: upcomingQuizzes } = await supabase
      .from('quiz_assignments')
      .select(`
        *,
        quizzes!inner (
          teacher_id
        )
      `)
      .eq('quizzes.teacher_id', teacher.id)
      .gte('due_date', new Date().toISOString())
      .order('due_date', { ascending: true });

    // Format classes data
    const formattedClasses = classes?.map(cls => {
      const enrollmentCount = cls.enrollments?.[0]?.count || 0;
      
      // Calculate average progress for this class
      const classEnrollments = allEnrollments?.filter(e => e.class_id === cls.id) || [];
      const avgProgress = classEnrollments.length > 0
        ? Math.round(classEnrollments.reduce((sum, e) => sum + (e.progress || 0), 0) / classEnrollments.length)
        : 0;

      return {
        id: cls.id,
        name: cls.class_name,
        grade: cls.grade,
        students: enrollmentCount,
        progress: avgProgress,
        code: cls.class_code,
        subject: cls.subject
      };
    }) || [];

    // Format lessons
    const formattedLessons = lessons?.map(lesson => ({
      id: lesson.id,
      title: lesson.title,
      grade: lesson.grade,
      description: lesson.description,
      objectives: lesson.objectives,
      status: lesson.status === 'published' ? 'Published' : 'Draft',
      date: new Date(lesson.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      createdAt: lesson.created_at,
      files: lesson.lesson_files || []
    })) || [];

    // Get top performers and students needing support
    const studentsWithScores = allEnrollments?.map(enrollment => {
      const student = enrollment.students;
      return {
        id: student.id,
        name: student.users.name,
        class: enrollment.classes.class_name,
        score: enrollment.progress || 0,
        progress: enrollment.progress || 0
      };
    }) || [];

    const topPerformers = [...studentsWithScores]
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    const needingSupport = [...studentsWithScores]
      .sort((a, b) => a.score - b.score)
      .slice(0, 20);

    res.json({
      stats: {
        totalStudents,
        totalClasses,
        averageScore,
        upcomingQuizzes: upcomingQuizzes?.length || 0
      },
      classes: formattedClasses,
      recentLessons: formattedLessons,
      allLessons: formattedLessons,
      topPerformers,
      needingSupport
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create class
app.post('/api/teacher/class', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { className, subject, grade } = req.body;

    if (!className || !subject || !grade) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Get teacher record
    const { data: teacher } = await supabase
      .from('teachers')
      .select('*')
      .eq('user_id', req.user.userId)
      .single();

    // Generate unique class code
    let classCode;
    let isUnique = false;
    while (!isUnique) {
      classCode = generateClassCode();
      const { data: existing } = await supabase
        .from('classes')
        .select('id')
        .eq('class_code', classCode)
        .single();
      
      if (!existing) isUnique = true;
    }

    // Create class
    const { data: newClass, error } = await supabase
      .from('classes')
      .insert([{
        teacher_id: teacher.id,
        class_code: classCode,
        class_name: className,
        subject,
        grade: parseInt(grade)
      }])
      .select()
      .single();

    if (error) {
      console.error('Class creation error:', error);
      return res.status(500).json({ error: 'Failed to create class' });
    }

    res.status(201).json({
      message: 'Class created successfully',
      class: {
        id: newClass.id,
        name: newClass.class_name,
        code: newClass.class_code,
        subject: newClass.subject,
        grade: newClass.grade,
        students: 0,
        progress: 0
      }
    });
  } catch (error) {
    console.error('Create class error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete class or disenroll all students
app.delete('/api/teacher/class/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { id } = req.params;
    const { action } = req.query; // 'delete' or 'disenroll'

    // Get teacher record
    const { data: teacher } = await supabase
      .from('teachers')
      .select('*')
      .eq('user_id', req.user.userId)
      .single();

    // Verify class belongs to teacher
    const { data: classData } = await supabase
      .from('classes')
      .select('*')
      .eq('id', id)
      .eq('teacher_id', teacher.id)
      .single();

    if (!classData) {
      return res.status(404).json({ error: 'Class not found' });
    }

    if (action === 'disenroll') {
      // Disenroll all students
      await supabase
        .from('enrollments')
        .delete()
        .eq('class_id', id);

      res.json({ message: 'All students disenrolled successfully' });
    } else {
      // Delete class (cascade will handle enrollments)
      await supabase
        .from('classes')
        .delete()
        .eq('id', id);

      res.json({ message: 'Class deleted successfully' });
    }
  } catch (error) {
    console.error('Delete class error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create/Update lesson
app.post('/api/teacher/lesson', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { id, title, grade, description, objectives, status, files } = req.body;

    if (!title || !grade) {
      return res.status(400).json({ error: 'Title and grade are required' });
    }

    // Get teacher record
    const { data: teacher } = await supabase
      .from('teachers')
      .select('*')
      .eq('user_id', req.user.userId)
      .single();

    if (id) {
      // Update existing lesson
      const { data: lesson, error } = await supabase
        .from('lessons')
        .update({
          title,
          grade: parseInt(grade),
          description,
          objectives,
          status: status || 'draft',
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .eq('teacher_id', teacher.id)
        .select()
        .single();

      if (error) {
        return res.status(500).json({ error: 'Failed to update lesson' });
      }

      // Save file metadata if provided
      if (files && Array.isArray(files)) {
        // Delete existing files for this lesson
        await supabase
          .from('lesson_files')
          .delete()
          .eq('lesson_id', id);

        // Insert new files
        if (files.length > 0) {
          const fileRecords = files.map(file => ({
            lesson_id: id,
            file_name: file.name,
            file_type: file.type, // This is our category: image, video, pdf, presentation
            file_url: file.url,
            file_size: file.size || 0
          }));

          await supabase
            .from('lesson_files')
            .insert(fileRecords);
        }
      }

      res.json({ message: 'Lesson updated successfully', lesson });
    } else {
      // Create new lesson
      const { data: lesson, error } = await supabase
        .from('lessons')
        .insert([{
          teacher_id: teacher.id,
          title,
          grade: parseInt(grade),
          description,
          objectives,
          status: status || 'draft'
        }])
        .select()
        .single();

      if (error) {
        return res.status(500).json({ error: 'Failed to create lesson' });
      }

      // Save file metadata if provided
      if (files && Array.isArray(files) && files.length > 0) {
        const fileRecords = files.map(file => ({
          lesson_id: lesson.id,
          file_name: file.name,
          file_type: file.type, // This is our category: image, video, pdf, presentation
          file_url: file.url,
          file_size: file.size || 0
        }));

        await supabase
          .from('lesson_files')
          .insert(fileRecords);
      }

      res.status(201).json({ message: 'Lesson created successfully', lesson });
    }
  } catch (error) {
    console.error('Lesson error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get lesson assignments
app.get('/api/teacher/lesson/:id/assignments', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { id } = req.params;

    // Get teacher record
    const { data: teacher } = await supabase
      .from('teachers')
      .select('*')
      .eq('user_id', req.user.userId)
      .single();

    // Verify lesson belongs to teacher
    const { data: lesson } = await supabase
      .from('lessons')
      .select('*')
      .eq('id', id)
      .eq('teacher_id', teacher.id)
      .single();

    if (!lesson) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    // Get assignments
    const { data: assignments } = await supabase
      .from('lesson_assignments')
      .select('class_id')
      .eq('lesson_id', id);

    const assignedClassIds = assignments?.map(a => a.class_id) || [];

    res.json({ assignedClassIds });
  } catch (error) {
    console.error('Get lesson assignments error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Assign lesson to classes
app.post('/api/teacher/lesson/:id/assign', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { id } = req.params;
    const { classIds } = req.body;

    if (!classIds || !Array.isArray(classIds)) {
      return res.status(400).json({ error: 'Class IDs are required' });
    }

    // Get teacher record
    const { data: teacher } = await supabase
      .from('teachers')
      .select('*')
      .eq('user_id', req.user.userId)
      .single();

    // Verify lesson belongs to teacher
    const { data: lesson } = await supabase
      .from('lessons')
      .select('*')
      .eq('id', id)
      .eq('teacher_id', teacher.id)
      .single();

    if (!lesson) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    // Delete existing assignments
    await supabase
      .from('lesson_assignments')
      .delete()
      .eq('lesson_id', id);

    // Create new assignments (only if classIds is not empty)
    if (classIds.length > 0) {
      const assignments = classIds.map(classId => ({
        lesson_id: id,
        class_id: classId
      }));

      const { error } = await supabase
        .from('lesson_assignments')
        .insert(assignments);

      if (error) {
        return res.status(500).json({ error: 'Failed to assign lesson' });
      }
    }

    res.json({ message: 'Lesson assigned successfully' });
  } catch (error) {
    console.error('Assign lesson error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete lesson
app.delete('/api/teacher/lesson/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { id } = req.params;

    // Get teacher record
    const { data: teacher } = await supabase
      .from('teachers')
      .select('*')
      .eq('user_id', req.user.userId)
      .single();

    // Verify lesson belongs to teacher
    const { data: lesson } = await supabase
      .from('lessons')
      .select('*')
      .eq('id', id)
      .eq('teacher_id', teacher.id)
      .single();

    if (!lesson) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    // Get all files associated with this lesson
    const { data: lessonFiles } = await supabase
      .from('lesson_files')
      .select('*')
      .eq('lesson_id', id);

    // Delete files from Supabase Storage
    if (lessonFiles && lessonFiles.length > 0) {
      const filePaths = lessonFiles.map(file => {
        // Extract path from URL
        // URL format: https://xxx.supabase.co/storage/v1/object/public/lesson-materials/lesson-files/timestamp-filename
        const url = file.file_url;
        const match = url.match(/lesson-materials\/(.+)$/);
        return match ? match[1] : null;
      }).filter(path => path !== null);

      if (filePaths.length > 0) {
        const { error: storageError } = await supabase
          .storage
          .from('lesson-materials')
          .remove(filePaths);

        if (storageError) {
          console.error('Failed to delete some files from storage:', storageError);
          // Continue with lesson deletion even if storage deletion fails
        } else {
          console.log(`Deleted ${filePaths.length} files from storage`);
        }
      }
    }

    // Delete lesson (cascade will handle lesson_files table and assignments)
    const { error } = await supabase
      .from('lessons')
      .delete()
      .eq('id', id);

    if (error) {
      return res.status(500).json({ error: 'Failed to delete lesson' });
    }

    res.json({ 
      message: 'Lesson deleted successfully',
      filesDeleted: lessonFiles?.length || 0
    });
  } catch (error) {
    console.error('Delete lesson error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Upload lesson file to Supabase Storage
app.post('/api/teacher/lesson/upload', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { fileName, fileType, fileData } = req.body;

    if (!fileName || !fileType || !fileData) {
      return res.status(400).json({ error: 'File name, type, and data are required' });
    }

    // Validate Supabase configuration
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ 
        error: 'Supabase configuration missing',
        details: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set'
      });
    }

    // Convert base64 to buffer
    let base64Data;
    try {
      base64Data = fileData.includes(',') ? fileData.split(',')[1] : fileData;
      if (!base64Data) {
        throw new Error('Invalid base64 data');
      }
    } catch (err) {
      return res.status(400).json({ error: 'Invalid file data format' });
    }

    const buffer = Buffer.from(base64Data, 'base64');

    // Validate buffer
    if (buffer.length === 0) {
      return res.status(400).json({ error: 'Empty file data' });
    }

    // Generate unique filename
    const timestamp = Date.now();
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const uniqueFileName = `${timestamp}-${sanitizedFileName}`;
    const filePath = `lesson-files/${uniqueFileName}`;

    console.log(`Uploading file: ${filePath}, size: ${buffer.length} bytes`);

    // Upload to Supabase Storage with retry logic
    let uploadData, uploadError;
    let retries = 3;
    
    while (retries > 0) {
      const result = await supabase
        .storage
        .from('lesson-materials')
        .upload(filePath, buffer, {
          contentType: fileType,
          upsert: false,
          duplex: 'half'
        });
      
      uploadData = result.data;
      uploadError = result.error;
      
      if (!uploadError) break;
      
      // If it's a network error, retry
      if (uploadError.message && uploadError.message.includes('fetch failed')) {
        retries--;
        if (retries > 0) {
          console.log(`Upload failed, retrying... (${retries} attempts left)`);
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
          continue;
        }
      }
      break;
    }

    if (uploadError) {
      console.error('Supabase upload error:', uploadError);
      
      // Provide specific error messages
      if (uploadError.message && uploadError.message.includes('not found')) {
        return res.status(500).json({ 
          error: 'Storage bucket not configured. Please create "lesson-materials" bucket in Supabase Storage.',
          details: uploadError.message
        });
      }
      
      if (uploadError.message && uploadError.message.includes('fetch failed')) {
        return res.status(500).json({ 
          error: 'Connection to Supabase Storage failed. Please check your network connection and Supabase URL.',
          details: uploadError.message
        });
      }
      
      return res.status(500).json({ 
        error: 'Failed to upload file', 
        details: uploadError.message || 'Unknown error'
      });
    }

    // Get public URL
    const { data: urlData } = supabase
      .storage
      .from('lesson-materials')
      .getPublicUrl(filePath);

    console.log(`File uploaded successfully: ${urlData.publicUrl}`);

    res.json({
      success: true,
      file: {
        name: fileName,
        type: fileType,
        url: urlData.publicUrl,
        size: buffer.length,
        path: filePath
      }
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ 
      error: 'Server error', 
      details: error.message || 'Unknown error'
    });
  }
});

// Publish lesson
app.patch('/api/teacher/lesson/:id/publish', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { id } = req.params;

    // Get teacher record
    const { data: teacher } = await supabase
      .from('teachers')
      .select('*')
      .eq('user_id', req.user.userId)
      .single();

    // Verify lesson belongs to teacher
    const { data: lesson } = await supabase
      .from('lessons')
      .select('*')
      .eq('id', id)
      .eq('teacher_id', teacher.id)
      .single();

    if (!lesson) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    // Update lesson status to published
    const { data: updatedLesson, error } = await supabase
      .from('lessons')
      .update({ 
        status: 'published',
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: 'Failed to publish lesson' });
    }

    res.json({ 
      message: 'Lesson published successfully',
      lesson: updatedLesson
    });
  } catch (error) {
    console.error('Publish lesson error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Upload quiz media to Supabase Storage
app.post('/api/teacher/quiz/upload', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { fileName, fileType, fileData } = req.body;

    if (!fileName || !fileType || !fileData) {
      return res.status(400).json({ error: 'File name, type, and data are required' });
    }

    // Validate Supabase configuration
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ 
        error: 'Supabase configuration missing',
        details: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set'
      });
    }

    // Convert base64 to buffer
    let base64Data;
    try {
      base64Data = fileData.includes(',') ? fileData.split(',')[1] : fileData;
      if (!base64Data) {
        throw new Error('Invalid base64 data');
      }
    } catch (err) {
      return res.status(400).json({ error: 'Invalid file data format' });
    }

    const buffer = Buffer.from(base64Data, 'base64');

    // Validate buffer
    if (buffer.length === 0) {
      return res.status(400).json({ error: 'Empty file data' });
    }

    // Generate unique filename
    const timestamp = Date.now();
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const uniqueFileName = `${timestamp}-${sanitizedFileName}`;
    const filePath = `quiz-media/${uniqueFileName}`;

    console.log(`Uploading quiz media: ${filePath}, size: ${buffer.length} bytes`);

    // Upload to Supabase Storage with retry logic
    let uploadData, uploadError;
    let retries = 3;
    
    while (retries > 0) {
      const result = await supabase
        .storage
        .from('lesson-materials')
        .upload(filePath, buffer, {
          contentType: fileType,
          upsert: false,
          duplex: 'half'
        });
      
      uploadData = result.data;
      uploadError = result.error;
      
      if (!uploadError) break;
      
      // If it's a network error, retry
      if (uploadError.message && uploadError.message.includes('fetch failed')) {
        retries--;
        if (retries > 0) {
          console.log(`Upload failed, retrying... (${retries} attempts left)`);
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
          continue;
        }
      }
      break;
    }

    if (uploadError) {
      console.error('Supabase upload error:', uploadError);
      
      // Provide specific error messages
      if (uploadError.message && uploadError.message.includes('not found')) {
        return res.status(500).json({ 
          error: 'Storage bucket not configured. Please create "lesson-materials" bucket in Supabase Storage.',
          details: uploadError.message
        });
      }
      
      if (uploadError.message && uploadError.message.includes('fetch failed')) {
        return res.status(500).json({ 
          error: 'Connection to Supabase Storage failed. Please check your network connection and Supabase URL.',
          details: uploadError.message
        });
      }
      
      return res.status(500).json({ 
        error: 'Failed to upload file', 
        details: uploadError.message || 'Unknown error'
      });
    }

    // Get public URL
    const { data: urlData } = supabase
      .storage
      .from('lesson-materials')
      .getPublicUrl(filePath);

    console.log(`Quiz media uploaded successfully: ${urlData.publicUrl}`);

    res.json({
      success: true,
      file: {
        name: fileName,
        type: fileType,
        url: urlData.publicUrl,
        size: buffer.length,
        path: filePath
      }
    });
  } catch (error) {
    console.error('Quiz upload error:', error);
    res.status(500).json({ 
      error: 'Server error', 
      details: error.message || 'Unknown error'
    });
  }
});

// Get all quizzes for teacher
app.get('/api/teacher/quizzes', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get teacher record
    const { data: teacher } = await supabase
      .from('teachers')
      .select('*')
      .eq('user_id', req.user.userId)
      .single();

    if (!teacher) {
      return res.status(404).json({ error: 'Teacher not found' });
    }

    // Get all quizzes with questions count
    const { data: quizzes } = await supabase
      .from('quizzes')
      .select(`
        *,
        quiz_questions (count)
      `)
      .eq('teacher_id', teacher.id)
      .order('created_at', { ascending: false });

    // Get quiz assignments and submissions for each quiz
    const quizzesWithStats = await Promise.all(quizzes?.map(async (quiz) => {
      // Get assignments
      const { data: assignments } = await supabase
        .from('quiz_assignments')
        .select(`
          *,
          classes (
            id,
            class_name,
            enrollments (count)
          )
        `)
        .eq('quiz_id', quiz.id);

      // Calculate total students across all assigned classes
      const totalStudents = assignments?.reduce((sum, assignment) => {
        return sum + (assignment.classes?.enrollments?.[0]?.count || 0);
      }, 0) || 0;

      // Get submissions
      const { data: submissions } = await supabase
        .from('quiz_submissions')
        .select('score')
        .eq('quiz_id', quiz.id);

      const submissionCount = submissions?.length || 0;
      const avgScore = submissions?.length > 0
        ? Math.round(submissions.reduce((sum, sub) => sum + (sub.score || 0), 0) / submissions.length)
        : 0;

      // Determine status
      let status = quiz.status === 'published' ? 'Active' : 'Draft';
      const isAssigned = assignments && assignments.length > 0;
      
      // Check if completed (past due date and all submitted)
      if (isAssigned && assignments.some(a => a.due_date && new Date(a.due_date) < new Date())) {
        const allSubmitted = totalStudents > 0 && submissionCount >= totalStudents;
        if (allSubmitted) {
          status = 'Completed';
        }
      }

      return {
        id: quiz.id,
        title: quiz.title,
        grade: quiz.grade,
        description: quiz.description,
        questions: quiz.quiz_questions?.[0]?.count || 0,
        timeLimit: quiz.time_limit,
        assigned: isAssigned,
        submissions: submissionCount,
        totalStudents,
        avgScore,
        status,
        dueDate: assignments?.[0]?.due_date ? new Date(assignments[0].due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null,
        createdAt: quiz.created_at
      };
    }) || []);

    res.json({ quizzes: quizzesWithStats });
  } catch (error) {
    console.error('Get quizzes error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create quiz
app.post('/api/teacher/quiz', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { title, grade, description, timeLimit, questions, status } = req.body;

    if (!title || !grade || !questions || questions.length === 0) {
      return res.status(400).json({ error: 'Title, grade, and questions are required' });
    }

    // Get teacher record
    const { data: teacher } = await supabase
      .from('teachers')
      .select('*')
      .eq('user_id', req.user.userId)
      .single();

    // Create quiz
    const { data: quiz, error: quizError } = await supabase
      .from('quizzes')
      .insert([{
        teacher_id: teacher.id,
        title,
        grade: parseInt(grade),
        description,
        time_limit: timeLimit ? parseInt(timeLimit) : null,
        status: status || 'draft'
      }])
      .select()
      .single();

    if (quizError) {
      return res.status(500).json({ error: 'Failed to create quiz' });
    }

    // Create questions
    const questionData = questions.map((q, index) => ({
      quiz_id: quiz.id,
      question_text: q.question,
      question_type: q.type,
      options: q.options ? JSON.stringify(q.options) : null,
      correct_answer: q.correctAnswer?.toString() || null,
      media_type: q.media?.type || null,
      media_url: q.media?.url || null,
      points: q.points || 1, // Default to 1 point if not specified
      order_number: index + 1
    }));

    const { error: questionsError } = await supabase
      .from('quiz_questions')
      .insert(questionData);

    if (questionsError) {
      // Rollback quiz creation
      await supabase.from('quizzes').delete().eq('id', quiz.id);
      return res.status(500).json({ error: 'Failed to create quiz questions' });
    }

    // Calculate and update total points
    const totalPoints = questionData.reduce((sum, q) => sum + (q.points || 1), 0);
    await supabase
      .from('quizzes')
      .update({ total_points: totalPoints })
      .eq('id', quiz.id);

    res.status(201).json({ message: 'Quiz created successfully', quiz });
  } catch (error) {
    console.error('Create quiz error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete quiz
app.delete('/api/teacher/quiz/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { id } = req.params;

    // Get teacher record
    const { data: teacher } = await supabase
      .from('teachers')
      .select('*')
      .eq('user_id', req.user.userId)
      .single();

    // Verify quiz belongs to teacher
    const { data: quiz } = await supabase
      .from('quizzes')
      .select('*')
      .eq('id', id)
      .eq('teacher_id', teacher.id)
      .single();

    if (!quiz) {
      return res.status(404).json({ error: 'Quiz not found' });
    }

    // Delete quiz (cascade will handle questions and assignments)
    const { error } = await supabase
      .from('quizzes')
      .delete()
      .eq('id', id);

    if (error) {
      return res.status(500).json({ error: 'Failed to delete quiz' });
    }

    res.json({ message: 'Quiz deleted successfully' });
  } catch (error) {
    console.error('Delete quiz error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get quiz assignments
app.get('/api/teacher/quiz/:id/assignments', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { id } = req.params;

    // Get teacher record
    const { data: teacher } = await supabase
      .from('teachers')
      .select('*')
      .eq('user_id', req.user.userId)
      .single();

    // Verify quiz belongs to teacher
    const { data: quiz } = await supabase
      .from('quizzes')
      .select('*')
      .eq('id', id)
      .eq('teacher_id', teacher.id)
      .single();

    if (!quiz) {
      return res.status(404).json({ error: 'Quiz not found' });
    }

    // Get assigned classes
    const { data: assignments } = await supabase
      .from('quiz_assignments')
      .select('class_id')
      .eq('quiz_id', id);

    const assignedClassIds = assignments ? assignments.map(a => a.class_id) : [];

    res.json({ assignedClassIds });
  } catch (error) {
    console.error('Get quiz assignments error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Assign quiz to classes
app.post('/api/teacher/quiz/:id/assign', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { id } = req.params;
    const { classIds, dueDate } = req.body;

    // Get teacher record
    const { data: teacher } = await supabase
      .from('teachers')
      .select('*')
      .eq('user_id', req.user.userId)
      .single();

    // Verify quiz belongs to teacher
    const { data: quiz } = await supabase
      .from('quizzes')
      .select('*')
      .eq('id', id)
      .eq('teacher_id', teacher.id)
      .single();

    if (!quiz) {
      return res.status(404).json({ error: 'Quiz not found' });
    }

    // Delete existing assignments
    await supabase
      .from('quiz_assignments')
      .delete()
      .eq('quiz_id', id);

    // Create new assignments
    if (classIds && classIds.length > 0) {
      const assignments = classIds.map(classId => ({
        quiz_id: id,
        class_id: classId,
        assigned_date: new Date().toISOString(),
        due_date: dueDate || null
      }));

      const { error } = await supabase
        .from('quiz_assignments')
        .insert(assignments);

      if (error) {
        console.error('Assignment error:', error);
        return res.status(500).json({ error: 'Failed to assign quiz', details: error.message });
      }
    }

    res.json({ message: 'Quiz assigned successfully' });
  } catch (error) {
    console.error('Assign quiz error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get class students with analytics
app.get('/api/teacher/students/:classId', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { classId } = req.params;

    // Get teacher record
    const { data: teacher } = await supabase
      .from('teachers')
      .select('*')
      .eq('user_id', req.user.userId)
      .single();

    // Verify class belongs to teacher
    const { data: classData } = await supabase
      .from('classes')
      .select('*')
      .eq('id', classId)
      .eq('teacher_id', teacher.id)
      .single();

    if (!classData) {
      return res.status(404).json({ error: 'Class not found' });
    }

    // Get enrolled students with their progress
    const { data: enrollments } = await supabase
      .from('enrollments')
      .select(`
        *,
        students (
          *,
          users (name, email)
        )
      `)
      .eq('class_id', classId);

    // Get quiz submissions for these students
    const studentIds = enrollments?.map(e => e.student_id) || [];
    
    const { data: submissions } = await supabase
      .from('quiz_submissions')
      .select('student_id, score')
      .in('student_id', studentIds);

    // Calculate average score per student
    const studentScores = {};
    submissions?.forEach(sub => {
      if (!studentScores[sub.student_id]) {
        studentScores[sub.student_id] = [];
      }
      studentScores[sub.student_id].push(sub.score || 0);
    });

    // Format student data
    const students = enrollments?.map(enrollment => {
      const scores = studentScores[enrollment.student_id] || [];
      const avgScore = scores.length > 0
        ? Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length)
        : 0;

      return {
        id: enrollment.students.id,
        name: enrollment.students.users.name,
        email: enrollment.students.users.email,
        studentNumber: enrollment.students.student_number,
        progress: enrollment.progress || 0,
        score: avgScore,
        enrolledDate: enrollment.enrolled_date
      };
    }) || [];

    res.json({ students });
  } catch (error) {
    console.error('Get students error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get classroom data (students across all classes)
app.get('/api/teacher/classroom', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get teacher record
    const { data: teacher } = await supabase
      .from('teachers')
      .select('*')
      .eq('user_id', req.user.userId)
      .single();

    if (!teacher) {
      return res.status(404).json({ error: 'Teacher not found' });
    }

    // Get all classes
    const { data: classes } = await supabase
      .from('classes')
      .select('*')
      .eq('teacher_id', teacher.id);

    const classIds = classes?.map(c => c.id) || [];

    // Get all enrollments with student details
    const { data: enrollments } = await supabase
      .from('enrollments')
      .select(`
        *,
        students (
          *,
          users (name, email)
        ),
        classes (
          id,
          class_name,
          grade
        )
      `)
      .in('class_id', classIds);

    // Get quiz submissions for score calculation
    const studentIds = enrollments?.map(e => e.student_id) || [];
    const { data: submissions } = await supabase
      .from('quiz_submissions')
      .select('student_id, score')
      .in('student_id', studentIds);

    // Calculate scores per student
    const studentScores = {};
    submissions?.forEach(sub => {
      if (!studentScores[sub.student_id]) {
        studentScores[sub.student_id] = [];
      }
      studentScores[sub.student_id].push(sub.score || 0);
    });

    // Get lesson assignments to count completed lessons
    const { data: lessonProgress } = await supabase
      .from('lesson_assignments')
      .select('class_id')
      .in('class_id', classIds);

    // Format students
    const students = enrollments?.map(enrollment => {
      const scores = studentScores[enrollment.student_id] || [];
      const avgScore = scores.length > 0
        ? Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length)
        : 0;

      // Calculate last active (mock for now - you can add a last_active column)
      const enrolledDate = new Date(enrollment.enrolled_date);
      const daysSince = Math.floor((Date.now() - enrolledDate.getTime()) / (1000 * 60 * 60 * 24));
      let lastActive = 'Today';
      if (daysSince > 0) lastActive = daysSince === 1 ? 'Yesterday' : `${daysSince} days ago`;

      return {
        id: enrollment.students.id,
        name: enrollment.students.users.name,
        email: enrollment.students.users.email,
        class: enrollment.classes.class_name,
        classId: enrollment.classes.id,
        grade: enrollment.classes.grade,
        progress: enrollment.progress || 0,
        avgScore,
        completedLessons: scores.length, // Using quiz count as proxy
        lastActive,
        status: daysSince <= 2 ? 'active' : 'inactive'
      };
    }) || [];

    // Format classes with counts and ensure uniqueness
    const uniqueClasses = new Map();
    classes?.forEach(cls => {
      if (!uniqueClasses.has(cls.id)) {
        const studentCount = enrollments?.filter(e => e.class_id === cls.id).length || 0;
        uniqueClasses.set(cls.id, {
          id: cls.id,
          name: cls.class_name,
          count: studentCount
        });
      }
    });

    const formattedClasses = Array.from(uniqueClasses.values());

    res.json({
      classes: [
        { id: 'all', name: 'All Students', count: students.length },
        ...formattedClasses
      ],
      students
    });
  } catch (error) {
    console.error('Classroom error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get activities and announcements for classroom
app.get('/api/teacher/classroom/posts', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get teacher record
    const { data: teacher } = await supabase
      .from('teachers')
      .select('*')
      .eq('user_id', req.user.userId)
      .single();

    if (!teacher) {
      return res.status(404).json({ error: 'Teacher not found' });
    }

    // Get all classes
    const { data: classes } = await supabase
      .from('classes')
      .select('*')
      .eq('teacher_id', teacher.id);

    const classIds = classes?.map(c => c.id) || [];

    // Get activities with submission counts
    const { data: activities } = await supabase
      .from('activities')
      .select(`
        *,
        classes (
          id,
          class_name,
          grade
        ),
        activity_submissions (count)
      `)
      .in('class_id', classIds)
      .order('created_at', { ascending: false });

    // Get enrollments to calculate total students per class
    const { data: enrollments } = await supabase
      .from('enrollments')
      .select('class_id, student_id')
      .in('class_id', classIds);

    // Count students per class
    const studentsPerClass = {};
    enrollments?.forEach(e => {
      studentsPerClass[e.class_id] = (studentsPerClass[e.class_id] || 0) + 1;
    });

    // Get all submissions for activities
    const activityIds = activities?.map(a => a.id) || [];
    const { data: allSubmissions } = await supabase
      .from('activity_submissions')
      .select(`
        activity_id,
        student_id,
        students (
          users (name)
        )
      `)
      .in('activity_id', activityIds);

    // Group submissions by activity
    const submissionsByActivity = {};
    allSubmissions?.forEach(sub => {
      if (!submissionsByActivity[sub.activity_id]) {
        submissionsByActivity[sub.activity_id] = [];
      }
      submissionsByActivity[sub.activity_id].push({
        studentId: sub.student_id,
        studentName: sub.students.users.name
      });
    });

    // Format activities
    const formattedActivities = activities?.map(activity => {
      const totalStudents = studentsPerClass[activity.class_id] || 0;
      const submissions = submissionsByActivity[activity.id] || [];
      const submitted = submissions.length;
      const pending = totalStudents - submitted;

      // Get students who haven't submitted
      const { data: classEnrollments } = supabase
        .from('enrollments')
        .select(`
          students (
            id,
            users (name)
          )
        `)
        .eq('class_id', activity.class_id);

      return {
        id: activity.id,
        title: activity.title,
        description: activity.description,
        class: activity.classes.class_name,
        classId: activity.classes.id,
        dueDate: activity.due_date ? new Date(activity.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null,
        totalStudents,
        submitted,
        pending,
        submittedStudents: submissions.map(s => s.studentName),
        createdAt: activity.created_at
      };
    }) || [];

    // Get announcements
    const { data: announcements } = await supabase
      .from('announcements')
      .select(`
        *,
        classes (
          id,
          class_name
        )
      `)
      .in('class_id', classIds)
      .order('created_at', { ascending: false })
      .limit(10);

    const formattedAnnouncements = announcements?.map(announcement => ({
      id: announcement.id,
      title: announcement.title,
      message: announcement.content,
      class: announcement.classes.class_name,
      classId: announcement.classes.id,
      date: new Date(announcement.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    })) || [];

    res.json({
      activities: formattedActivities,
      announcements: formattedAnnouncements
    });
  } catch (error) {
    console.error('Posts error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Post announcement
app.post('/api/teacher/announcement', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { classId, title, content } = req.body;

    if (!classId || !title || !content) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Get teacher record
    const { data: teacher } = await supabase
      .from('teachers')
      .select('*')
      .eq('user_id', req.user.userId)
      .single();

    // Verify class belongs to teacher
    const { data: classData } = await supabase
      .from('classes')
      .select('*')
      .eq('id', classId)
      .eq('teacher_id', teacher.id)
      .single();

    if (!classData) {
      return res.status(404).json({ error: 'Class not found' });
    }

    // Create announcement
    const { data: announcement, error } = await supabase
      .from('announcements')
      .insert([{
        class_id: classId,
        title,
        content
      }])
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: 'Failed to create announcement' });
    }

    res.status(201).json({
      message: 'Announcement posted successfully',
      announcement: {
        id: announcement.id,
        title: announcement.title,
        message: announcement.content,
        class: classData.class_name,
        date: new Date(announcement.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      }
    });
  } catch (error) {
    console.error('Announcement error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Post activity
app.post('/api/teacher/activity', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { classId, title, description, dueDate } = req.body;

    if (!classId || !title) {
      return res.status(400).json({ error: 'Class ID and title are required' });
    }

    // Get teacher record
    const { data: teacher } = await supabase
      .from('teachers')
      .select('*')
      .eq('user_id', req.user.userId)
      .single();

    // Verify class belongs to teacher
    const { data: classData } = await supabase
      .from('classes')
      .select('*')
      .eq('id', classId)
      .eq('teacher_id', teacher.id)
      .single();

    if (!classData) {
      return res.status(404).json({ error: 'Class not found' });
    }

    // Create activity
    const { data: activity, error } = await supabase
      .from('activities')
      .insert([{
        class_id: classId,
        title,
        description,
        due_date: dueDate || null
      }])
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: 'Failed to create activity' });
    }

    res.status(201).json({
      message: 'Activity posted successfully',
      activity: {
        id: activity.id,
        title: activity.title,
        description: activity.description,
        class: classData.class_name,
        dueDate: activity.due_date ? new Date(activity.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null
      }
    });
  } catch (error) {
    console.error('Activity error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================
// STUDENT ENDPOINTS
// ============================================

// Get student dashboard data
app.get('/api/student/dashboard', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get student record
    const { data: student } = await supabase
      .from('students')
      .select('*')
      .eq('user_id', req.user.userId)
      .single();

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Get enrolled classes with teacher info
    const { data: enrollments } = await supabase
      .from('enrollments')
      .select(`
        *,
        classes (
          *,
          teachers (
            users (name)
          )
        )
      `)
      .eq('student_id', student.id);

    // Format classes
    const classes = enrollments?.map(e => ({
      id: e.classes.id,
      classCode: e.classes.class_code,
      className: e.classes.class_name,
      teacher: e.classes.teachers.users.name,
      subject: e.classes.subject,
      grade: e.classes.grade,
      progress: e.progress || 0
    })) || [];

    // Get class IDs
    const classIds = classes.map(c => c.id);

    // Get assigned lessons for these classes
    const { data: lessonAssignments } = await supabase
      .from('lesson_assignments')
      .select(`
        *,
        lessons (
          *,
          lesson_files (*)
        )
      `)
      .in('class_id', classIds);

    // Get lesson completions for this student
    const lessonIds = lessonAssignments?.map(a => a.lessons.id) || [];
    const { data: completions } = await supabase
      .from('lesson_completions')
      .select('*')
      .eq('student_id', student.id)
      .in('lesson_id', lessonIds);

    // Create completion map for quick lookup
    const completionMap = {};
    completions?.forEach(c => {
      completionMap[c.lesson_id] = {
        completed: true,
        stars: c.stars || 0,
        completedAt: c.completed_at
      };
    });

    // Format lessons with files and class info
    const lessons = lessonAssignments?.map(assignment => {
      const classInfo = classes.find(c => c.id === assignment.class_id);
      const completion = completionMap[assignment.lessons.id] || { completed: false, stars: 0 };
      
      return {
        id: assignment.lessons.id,
        title: assignment.lessons.title,
        grade: assignment.lessons.grade,
        description: assignment.lessons.description,
        objectives: assignment.lessons.objectives,
        status: assignment.lessons.status,
        classId: assignment.class_id,
        className: classInfo?.className || 'Unknown Class',
        files: assignment.lessons.lesson_files || [],
        completed: completion.completed,
        stars: completion.stars,
        completedAt: completion.completedAt,
        locked: false
      };
    }) || [];

    // Get quiz submissions for stats
    const { data: quizSubmissions } = await supabase
      .from('quiz_submissions')
      .select('score')
      .eq('student_id', student.id);

    // Calculate stats from lesson completions
    const totalStarsFromLessons = completions?.reduce((sum, c) => sum + (c.stars || 0), 0) || 0;
    const totalStarsFromQuizzes = quizSubmissions?.reduce((sum, sub) => {
      if (sub.score >= 90) return sum + 3;
      if (sub.score >= 75) return sum + 2;
      if (sub.score >= 60) return sum + 1;
      return sum;
    }, 0) || 0;
    const totalStars = totalStarsFromLessons + totalStarsFromQuizzes;
    const completedLessonsCount = completions?.length || 0;

    const recentQuizzes = quizSubmissions?.slice(-5).map((sub, idx) => ({
      id: idx,
      title: `Quiz ${idx + 1}`,
      score: sub.score || 0,
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    })) || [];

    res.json({
      student: {
        id: student.id,
        grade: student.grade,
        studentNumber: student.student_number
      },
      classes,
      lessons,
      stats: {
        totalStars,
        level: Math.floor(totalStars / 10) + 1,
        streak: 0, // TODO: Implement streak tracking
        completedLessons: completedLessonsCount,
        totalLessons: lessons.length
      },
      currentLesson: lessons.length > 0 ? lessons[0].title : 'No active lesson',
      recentQuizzes,
      achievements: [] // TODO: Implement achievements
    });
  } catch (error) {
    console.error('Student dashboard error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Enroll in class using code
app.post('/api/student/enroll', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { classCode } = req.body;

    if (!classCode) {
      return res.status(400).json({ error: 'Class code is required' });
    }

    // Get student record
    const { data: student } = await supabase
      .from('students')
      .select('*')
      .eq('user_id', req.user.userId)
      .single();

    // Find class by code
    const { data: classData } = await supabase
      .from('classes')
      .select('*')
      .eq('class_code', classCode.toUpperCase())
      .single();

    if (!classData) {
      return res.status(404).json({ error: 'Invalid class code' });
    }

    // Check if student's grade matches class grade
    if (student.grade && classData.grade && student.grade !== classData.grade) {
      return res.status(400).json({ 
        error: `This class is for Grade ${classData.grade} students. You are enrolled in Grade ${student.grade}.` 
      });
    }

    // Check if already enrolled
    const { data: existing } = await supabase
      .from('enrollments')
      .select('*')
      .eq('student_id', student.id)
      .eq('class_id', classData.id)
      .single();

    if (existing) {
      return res.status(400).json({ error: 'Already enrolled in this class' });
    }

    // Enroll student
    const { error } = await supabase
      .from('enrollments')
      .insert([{
        student_id: student.id,
        class_id: classData.id,
        progress: 0
      }]);

    if (error) {
      return res.status(500).json({ error: 'Failed to enroll' });
    }

    res.status(201).json({ message: 'Enrolled successfully', class: classData });
  } catch (error) {
    console.error('Enroll error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update student grade
app.patch('/api/student/grade', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { grade } = req.body;

    if (!grade || grade < 1 || grade > 12) {
      return res.status(400).json({ error: 'Valid grade (1-12) is required' });
    }

    // Get student record
    const { data: student } = await supabase
      .from('students')
      .select('*')
      .eq('user_id', req.user.userId)
      .single();

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Update grade
    const { error } = await supabase
      .from('students')
      .update({ grade: parseInt(grade) })
      .eq('id', student.id);

    if (error) {
      return res.status(500).json({ error: 'Failed to update grade' });
    }

    res.json({ message: 'Grade updated successfully', grade: parseInt(grade) });
  } catch (error) {
    console.error('Update grade error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Complete a lesson
app.post('/api/student/lesson/:id/complete', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { id } = req.params;
    const { stars } = req.body; // Optional: stars earned (1-3)

    // Get student record
    const { data: student } = await supabase
      .from('students')
      .select('*')
      .eq('user_id', req.user.userId)
      .single();

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Verify lesson exists
    const { data: lesson } = await supabase
      .from('lessons')
      .select('*')
      .eq('id', id)
      .single();

    if (!lesson) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    // Check if already completed
    const { data: existing } = await supabase
      .from('lesson_completions')
      .select('*')
      .eq('student_id', student.id)
      .eq('lesson_id', id)
      .single();

    if (existing) {
      // Update existing completion
      const { error } = await supabase
        .from('lesson_completions')
        .update({
          stars: stars || existing.stars,
          completed_at: new Date().toISOString()
        })
        .eq('id', existing.id);

      if (error) {
        return res.status(500).json({ error: 'Failed to update lesson completion' });
      }

      return res.json({ 
        message: 'Lesson completion updated',
        stars: stars || existing.stars
      });
    }

    // Create new completion record
    const { data: completion, error } = await supabase
      .from('lesson_completions')
      .insert([{
        student_id: student.id,
        lesson_id: id,
        stars: stars || 0,
        completed_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (error) {
      console.error('Lesson completion error:', error);
      return res.status(500).json({ error: 'Failed to complete lesson' });
    }

    // Update student's overall progress in enrolled classes
    // Get all classes this lesson is assigned to
    const { data: assignments } = await supabase
      .from('lesson_assignments')
      .select('class_id')
      .eq('lesson_id', id);

    const classIds = assignments?.map(a => a.class_id) || [];

    // Update progress for each enrolled class
    for (const classId of classIds) {
      const { data: enrollment } = await supabase
        .from('enrollments')
        .select('*')
        .eq('student_id', student.id)
        .eq('class_id', classId)
        .single();

      if (enrollment) {
        // Get total lessons and quizzes for this class
        const { data: totalLessons } = await supabase
          .from('lesson_assignments')
          .select('lesson_id')
          .eq('class_id', classId);

        const { data: totalQuizzes } = await supabase
          .from('quiz_assignments')
          .select('quiz_id')
          .eq('class_id', classId);

        // Get completed lessons and quizzes for this student in this class
        const lessonIds = totalLessons?.map(l => l.lesson_id) || [];
        const quizIds = totalQuizzes?.map(q => q.quiz_id) || [];

        const { data: completedLessons } = await supabase
          .from('lesson_completions')
          .select('lesson_id')
          .eq('student_id', student.id)
          .in('lesson_id', lessonIds);

        const { data: completedQuizzes } = await supabase
          .from('quiz_submissions')
          .select('quiz_id')
          .eq('student_id', student.id)
          .in('quiz_id', quizIds);

        // Calculate progress percentage (lessons + quizzes)
        const totalActivities = (totalLessons?.length || 0) + (totalQuizzes?.length || 0);
        const completedActivities = (completedLessons?.length || 0) + (completedQuizzes?.length || 0);
        
        const progress = totalActivities > 0
          ? Math.round((completedActivities / totalActivities) * 100)
          : 0;

        // Update enrollment progress
        await supabase
          .from('enrollments')
          .update({ progress })
          .eq('id', enrollment.id);
      }
    }

    res.status(201).json({
      message: 'Lesson completed successfully',
      completion: {
        id: completion.id,
        lessonId: id,
        stars: completion.stars,
        completedAt: completion.completed_at
      }
    });
  } catch (error) {
    console.error('Complete lesson error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get assigned quizzes for student
app.get('/api/student/quizzes', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get student record
    const { data: student } = await supabase
      .from('students')
      .select('*')
      .eq('user_id', req.user.userId)
      .single();

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Get enrolled classes
    const { data: enrollments } = await supabase
      .from('enrollments')
      .select('class_id')
      .eq('student_id', student.id);

    const classIds = enrollments?.map(e => e.class_id) || [];

    if (classIds.length === 0) {
      return res.json({ quizzes: [] });
    }

    // Get quiz assignments for these classes
    const { data: assignments } = await supabase
      .from('quiz_assignments')
      .select(`
        *,
        quizzes (
          *,
          quiz_questions (count)
        ),
        classes (
          class_name,
          grade
        )
      `)
      .in('class_id', classIds);

    // Get student's quiz submissions
    const quizIds = assignments?.map(a => a.quiz_id) || [];
    const { data: submissions } = await supabase
      .from('quiz_submissions')
      .select('*')
      .eq('student_id', student.id)
      .in('quiz_id', quizIds);

    // Create submission map
    const submissionMap = {};
    submissions?.forEach(sub => {
      submissionMap[sub.quiz_id] = sub;
    });

    // Get question counts for each quiz
    const questionCounts = {};
    for (const assignment of assignments || []) {
      const { count } = await supabase
        .from('quiz_questions')
        .select('*', { count: 'exact', head: true })
        .eq('quiz_id', assignment.quiz_id);
      questionCounts[assignment.quiz_id] = count || 0;
    }

    // Get submission counts (attempts)
    const attemptCounts = {};
    for (const quizId of quizIds) {
      const { count } = await supabase
        .from('quiz_submissions')
        .select('*', { count: 'exact', head: true })
        .eq('student_id', student.id)
        .eq('quiz_id', quizId);
      attemptCounts[quizId] = count || 0;
    }

    // Get best scores
    const bestScores = {};
    for (const quizId of quizIds) {
      const { data: bestSubmission } = await supabase
        .from('quiz_submissions')
        .select('score')
        .eq('student_id', student.id)
        .eq('quiz_id', quizId)
        .order('score', { ascending: false })
        .limit(1)
        .single();
      if (bestSubmission) {
        bestScores[quizId] = bestSubmission.score;
      }
    }

    // Format quizzes to match frontend interface
    const quizzes = assignments?.map(assignment => {
      const hasSubmission = !!submissionMap[assignment.quiz_id];
      
      return {
        id: assignment.quizzes.id,
        title: assignment.quizzes.title,
        description: assignment.quizzes.description,
        totalPoints: assignment.quizzes.total_points || 100,
        timeLimit: assignment.quizzes.time_limit || 30,
        questionCount: questionCounts[assignment.quiz_id] || 0,
        classId: assignment.class_id,
        className: assignment.classes.class_name,
        grade: assignment.classes.grade,
        dueDate: assignment.due_date,
        completed: hasSubmission,
        bestScore: bestScores[assignment.quiz_id],
        attempts: attemptCounts[assignment.quiz_id] || 0
      };
    }) || [];

    res.json(quizzes);
  } catch (error) {
    console.error('Get student quizzes error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get quiz details with questions
app.get('/api/student/quiz/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { id } = req.params;

    // Get student record
    const { data: student } = await supabase
      .from('students')
      .select('*')
      .eq('user_id', req.user.userId)
      .single();

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Get quiz with questions
    const { data: quiz } = await supabase
      .from('quizzes')
      .select(`
        *,
        quiz_questions (*)
      `)
      .eq('id', id)
      .single();

    if (!quiz) {
      return res.status(404).json({ error: 'Quiz not found' });
    }

    // Verify student has access to this quiz (enrolled in assigned class)
    const { data: enrollments } = await supabase
      .from('enrollments')
      .select('class_id')
      .eq('student_id', student.id);

    const classIds = enrollments?.map(e => e.class_id) || [];

    const { data: assignment } = await supabase
      .from('quiz_assignments')
      .select('*')
      .eq('quiz_id', id)
      .in('class_id', classIds)
      .single();

    if (!assignment) {
      return res.status(403).json({ error: 'Quiz not assigned to your class' });
    }

    // Check if already submitted
    const { data: existingSubmission } = await supabase
      .from('quiz_submissions')
      .select('*')
      .eq('quiz_id', id)
      .eq('student_id', student.id)
      .single();

    if (existingSubmission) {
      return res.status(400).json({ 
        error: 'Quiz already submitted',
        submission: existingSubmission
      });
    }

    res.json({
      quiz: {
        id: quiz.id,
        title: quiz.title,
        description: quiz.description,
        time_limit_minutes: quiz.time_limit,
        total_points: quiz.total_points,
        questions: quiz.quiz_questions.map(q => ({
          id: q.id,
          question_text: q.question_text,
          question_type: q.question_type,
          options: q.options ? (typeof q.options === 'string' ? JSON.parse(q.options) : q.options) : null,
          correct_answer: q.correct_answer,
          points: q.points,
          media_url: q.media_url,
          media_type: q.media_type
        }))
      }
    });
  } catch (error) {
    console.error('Get quiz details error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Submit quiz answers
app.post('/api/student/quiz/:id/submit', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { id } = req.params;
    const { answers } = req.body; // Array of { questionId, answer }

    // Get student record
    const { data: student } = await supabase
      .from('students')
      .select('*')
      .eq('user_id', req.user.userId)
      .single();

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Get quiz with questions and correct answers
    const { data: quiz } = await supabase
      .from('quizzes')
      .select(`
        *,
        quiz_questions (*)
      `)
      .eq('id', id)
      .single();

    if (!quiz) {
      return res.status(404).json({ error: 'Quiz not found' });
    }

    // Check if already submitted
    const { data: existingSubmission } = await supabase
      .from('quiz_submissions')
      .select('*')
      .eq('quiz_id', id)
      .eq('student_id', student.id)
      .single();

    if (existingSubmission) {
      return res.status(400).json({ error: 'Quiz already submitted' });
    }

    // Calculate score
    let totalPoints = 0;
    let earnedPoints = 0;
    const results = [];

    quiz.quiz_questions.forEach(question => {
      // Convert questionId to string for comparison since it comes from frontend as string
      const studentAnswer = answers.find(a => String(a.questionId) === String(question.id));
      
      // Normalize answers for comparison (trim whitespace and handle case for true/false)
      let isCorrect = false;
      if (studentAnswer && studentAnswer.answer && question.correct_answer) {
        const studentAns = String(studentAnswer.answer).trim();
        const correctAns = String(question.correct_answer).trim();
        
        // For multiple choice and true/false, do exact match
        // For open-ended, teacher will grade manually (for now, mark as incorrect)
        if (question.question_type === 'open-ended') {
          isCorrect = false; // Open-ended requires manual grading
        } else {
          isCorrect = studentAns === correctAns;
        }
      }
      
      totalPoints += question.points || 1;
      if (isCorrect) {
        earnedPoints += question.points || 1;
      }

      results.push({
        questionId: question.id,
        studentAnswer: studentAnswer?.answer || null,
        correctAnswer: question.correct_answer,
        isCorrect,
        points: isCorrect ? (question.points || 1) : 0
      });
    });

    const score = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0;

    // Save submission
    const { data: submission, error } = await supabase
      .from('quiz_submissions')
      .insert([{
        quiz_id: id,
        student_id: student.id,
        answers: answers,
        score: score,
        submitted_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (error) {
      console.error('Quiz submission error:', error);
      return res.status(500).json({ error: 'Failed to submit quiz' });
    }

    // Update enrollment progress
    // Get the class this quiz is assigned to for this student
    const { data: quizAssignments } = await supabase
      .from('quiz_assignments')
      .select('class_id')
      .eq('quiz_id', id);

    if (quizAssignments && quizAssignments.length > 0) {
      // Get student's enrollments in these classes
      const classIds = quizAssignments.map(qa => qa.class_id);
      const { data: enrollments } = await supabase
        .from('enrollments')
        .select('id, class_id, progress')
        .eq('student_id', student.id)
        .in('class_id', classIds);

      // Update progress for each enrollment
      for (const enrollment of enrollments || []) {
        // Get total assigned quizzes and lessons for this class
        const { data: totalQuizzes } = await supabase
          .from('quiz_assignments')
          .select('quiz_id')
          .eq('class_id', enrollment.class_id);

        const { data: totalLessons } = await supabase
          .from('lesson_assignments')
          .select('lesson_id')
          .eq('class_id', enrollment.class_id);

        // Get completed quizzes and lessons for this student in this class
        const { data: completedQuizzes } = await supabase
          .from('quiz_submissions')
          .select('quiz_id')
          .eq('student_id', student.id)
          .in('quiz_id', (totalQuizzes || []).map(q => q.quiz_id));

        const { data: completedLessons } = await supabase
          .from('lesson_completions')
          .select('lesson_id')
          .eq('student_id', student.id)
          .in('lesson_id', (totalLessons || []).map(l => l.lesson_id));

        const totalActivities = (totalQuizzes?.length || 0) + (totalLessons?.length || 0);
        const completedActivities = (completedQuizzes?.length || 0) + (completedLessons?.length || 0);
        
        const newProgress = totalActivities > 0 
          ? Math.round((completedActivities / totalActivities) * 100)
          : 0;

        // Update enrollment progress
        await supabase
          .from('enrollments')
          .update({ progress: newProgress })
          .eq('id', enrollment.id);
      }
    }

    res.status(201).json({
      message: 'Quiz submitted successfully',
      submission: {
        id: submission.id,
        score,
        results,
        submittedAt: submission.submitted_at
      }
    });
  } catch (error) {
    console.error('Submit quiz error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================
// UTILITY ENDPOINTS
// ============================================

// Recalculate progress for all enrollments
app.post('/api/admin/recalculate-progress', authenticateToken, async (req, res) => {
  try {
    console.log('[RECALCULATE] Starting progress recalculation...');
    
    // Get all enrollments
    const { data: enrollments, error: enrollError } = await supabase
      .from('enrollments')
      .select('id, student_id, class_id, progress');

    if (enrollError) {
      console.error('[RECALCULATE] Error fetching enrollments:', enrollError);
      return res.status(500).json({ error: 'Failed to fetch enrollments' });
    }

    console.log(`[RECALCULATE] Found ${enrollments?.length || 0} enrollments to process`);

    let updated = 0;
    let skipped = 0;

    // Process each enrollment
    for (const enrollment of enrollments || []) {
      try {
        // Get total lessons and quizzes for this class
        const { data: totalLessons } = await supabase
          .from('lesson_assignments')
          .select('lesson_id')
          .eq('class_id', enrollment.class_id);

        const { data: totalQuizzes } = await supabase
          .from('quiz_assignments')
          .select('quiz_id')
          .eq('class_id', enrollment.class_id);

        const lessonIds = totalLessons?.map(l => l.lesson_id) || [];
        const quizIds = totalQuizzes?.map(q => q.quiz_id) || [];

        // Get completed lessons and quizzes for this student
        const { data: completedLessons } = await supabase
          .from('lesson_completions')
          .select('lesson_id')
          .eq('student_id', enrollment.student_id)
          .in('lesson_id', lessonIds);

        const { data: completedQuizzes } = await supabase
          .from('quiz_submissions')
          .select('quiz_id')
          .eq('student_id', enrollment.student_id)
          .in('quiz_id', quizIds);

        // Calculate progress
        const totalActivities = (totalLessons?.length || 0) + (totalQuizzes?.length || 0);
        const completedActivities = (completedLessons?.length || 0) + (completedQuizzes?.length || 0);
        
        const newProgress = totalActivities > 0
          ? Math.round((completedActivities / totalActivities) * 100)
          : 0;

        // Update only if progress changed
        if (newProgress !== enrollment.progress) {
          await supabase
            .from('enrollments')
            .update({ progress: newProgress })
            .eq('id', enrollment.id);
          
          console.log(`[RECALCULATE] Updated enrollment ${enrollment.id}: ${enrollment.progress}% → ${newProgress}%`);
          updated++;
        } else {
          skipped++;
        }
      } catch (error) {
        console.error(`[RECALCULATE] Error processing enrollment ${enrollment.id}:`, error);
      }
    }

    console.log(`[RECALCULATE] Completed! Updated: ${updated}, Skipped: ${skipped}`);

    res.json({
      message: 'Progress recalculation completed',
      stats: {
        total: enrollments?.length || 0,
        updated,
        skipped
      }
    });
  } catch (error) {
    console.error('[RECALCULATE] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
