# Math Mates Backend API

Backend server for Math Mates e-learning platform using Node.js, Express, and Supabase.

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Setup Supabase

1. Go to [Supabase](https://supabase.com) and create a new project
2. Once your project is created, go to **Settings** > **API**
3. Copy your:
   - Project URL
   - `anon` public key
   - `service_role` secret key

### 3. Create Database Tables

1. Go to your Supabase project dashboard
2. Click on **SQL Editor** in the left sidebar
3. Copy the contents of `supabase-schema.sql`
4. Paste it into the SQL Editor and click **Run**

This will create all the necessary tables:
- users
- teachers
- students
- parents
- classes
- enrollments
- parent_student_links
- announcements
- activities
- activity_submissions

### 4. Configure Environment Variables

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and add your Supabase credentials:
   ```env
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_ANON_KEY=your_anon_key_here
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
   JWT_SECRET=your_random_secret_key_here
   PORT=3001
   ```

   **Important:** 
   - Replace `your-project` with your actual Supabase project reference
   - Use the `service_role` key (not the `anon` key) for SUPABASE_SERVICE_ROLE_KEY
   - Generate a strong random string for JWT_SECRET

### 5. Start the Server

Development mode (with auto-reload):
```bash
npm run dev
```

Production mode:
```bash
npm start
```

The server will run on `http://localhost:3001`

## API Endpoints

### Authentication

#### Register
```http
POST /api/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123",
  "name": "John Doe",
  "role": "student" // or "teacher" or "parent"
}
```

Response:
```json
{
  "message": "User created successfully",
  "token": "jwt_token_here",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "student",
    "isNewUser": true
  }
}
```

#### Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}
```

Response:
```json
{
  "token": "jwt_token_here",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "student",
    "isNewUser": false,
    "studentNumber": "STU000001",
    "grade": 4,
    "enrolledClasses": []
  }
}
```

#### Get Profile (Protected)
```http
GET /api/auth/profile
Authorization: Bearer jwt_token_here
```

Response:
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "student",
    "isNewUser": false
  }
}
```

## Database Schema

### Users Table
- `id` (UUID, Primary Key)
- `email` (TEXT, Unique)
- `password` (TEXT, Hashed)
- `name` (TEXT)
- `role` (TEXT: 'student', 'teacher', 'parent')
- `is_new_user` (BOOLEAN)
- `created_at` (TIMESTAMP)

### Role-Specific Tables
- **teachers**: Links to users table
- **students**: Has student_number and grade
- **parents**: Links to users table

### Classes & Enrollments
- **classes**: Created by teachers
- **enrollments**: Students enrolled in classes
- **parent_student_links**: Parents linked to students

## Security

- Passwords are hashed using bcrypt
- JWT tokens for authentication
- Row Level Security (RLS) enabled on all tables
- Service role key used for server-side operations

## Testing

You can test the API using tools like:
- Postman
- Thunder Client (VS Code extension)
- curl commands

Example curl command:
```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "test123",
    "name": "Test User",
    "role": "student"
  }'
```

## Troubleshooting

### "Cannot connect to Supabase"
- Check your SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env
- Make sure your Supabase project is active

### "Table does not exist"
- Run the SQL schema in Supabase SQL Editor
- Check if tables were created successfully

### "Invalid credentials"
- Make sure you're using the correct email and password
- Check if the user exists in the database

## Next Steps

After setting up the backend:
1. Update the frontend to use the API endpoints
2. Replace mock data with real API calls
3. Implement additional features (classes, assignments, etc.)
