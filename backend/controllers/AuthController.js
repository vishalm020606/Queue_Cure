import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';

const JWT_SECRET = process.env.JWT_SECRET || 'queue_cure_super_secret_key';

// Helper to generate a JWT token
const generateToken = (user) => {
  return jwt.sign(
    { id: user._id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
};

// Seed default users if none exist in the database
export const seedDefaultUsers = async () => {
  try {
    const userCount = await User.countDocuments();
    if (userCount === 0) {
      const receptionistPass = await bcrypt.hash('receptionist123', 10);
      const doctorPass = await bcrypt.hash('doctor123', 10);
      
      await User.create([
        { username: 'receptionist', password: receptionistPass, role: 'receptionist' },
        { username: 'doctor', password: doctorPass, role: 'doctor' }
      ]);
      console.log('Default user accounts seeded successfully:');
      console.log(' - Receptionist: username "receptionist", password "receptionist123"');
      console.log(' - Doctor:       username "doctor", password "doctor123"');
    }
  } catch (error) {
    console.error('Error seeding default users:', error.message);
  }
};

// User registration
export const register = async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !role) {
    return res.status(400).json({ success: false, error: 'All fields are required.' });
  }

  try {
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ success: false, error: 'Username already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      username,
      password: hashedPassword,
      role
    });

    const token = generateToken(user);
    res.status(201).json({
      success: true,
      token,
      user: { id: user._id, username: user.username, role: user.role }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// User login
export const login = async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password are required.' });
  }

  try {
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ success: false, error: 'Invalid username or password.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ success: false, error: 'Invalid username or password.' });
    }

    const token = generateToken(user);
    res.json({
      success: true,
      token,
      user: { id: user._id, username: user.username, role: user.role }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
