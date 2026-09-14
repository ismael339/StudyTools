// User tracking and stats system for StudyTools

async function trackUsage(toolName) {
  try {
    const auth = firebase.auth();
    const user = auth.currentUser;

    if (!user) {
      console.log('User not logged in, skipping tracking');
      return;
    }

    const db = firebase.firestore();
    const userRef = db.collection('users').doc(user.email);

    // Get current user data
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      console.log('User document does not exist');
      return;
    }

    const userData = userDoc.data();
    const stats = userData.stats || {
      aiTutor: 0,
      examSolver: 0,
      gpaCalculator: 0,
      pomodoroTimer: 0,
      streakDays: 0,
      lastUsedDate: null
    };

    // Update stats based on tool
    switch(toolName) {
      case 'ai-tutor':
        stats.aiTutor++;
        break;
      case 'exam-solver':
        stats.examSolver++;
        break;
      case 'gpa-calculator':
        stats.gpaCalculator++;
        break;
      case 'pomodoro-timer':
        stats.pomodoroTimer++;
        break;
    }

    // Update streak
    const today = new Date().toDateString();
    if (stats.lastUsedDate !== today) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      if (stats.lastUsedDate === yesterday.toDateString()) {
        stats.streakDays++;
      } else if (stats.lastUsedDate !== today) {
        stats.streakDays = 1;
      }
      stats.lastUsedDate = today;
    }

    // Save updated stats
    await userRef.update({
      stats: stats,
      lastUsed: firebase.firestore.FieldValue.serverTimestamp()
    });

    // Check for achievements
    await checkAchievements(user.email, stats);

    console.log(`Usage tracked for ${toolName}:`, stats);
  } catch (error) {
    console.error('Error tracking usage:', error);
  }
}

async function checkAchievements(email, stats) {
  try {
    const db = firebase.firestore();
    const userRef = db.collection('users').doc(email);
    const userDoc = await userRef.get();
    const userData = userDoc.data();
    const achievements = userData.achievements || [];

    const newAchievements = [];

    // Check achievements
    if (stats.aiTutor >= 1 && !achievements.includes('first-question')) {
      newAchievements.push('first-question');
    }

    if (stats.aiTutor >= 10 && !achievements.includes('ten-questions')) {
      newAchievements.push('ten-questions');
    }

    if (stats.gpaCalculator >= 1 && !achievements.includes('first-gpa')) {
      newAchievements.push('first-gpa');
    }

    if (stats.streakDays >= 7 && !achievements.includes('week-streak')) {
      newAchievements.push('week-streak');
    }

    if (stats.pomodoroTimer >= 10 && !achievements.includes('pomodoro-master')) {
      newAchievements.push('pomodoro-master');
    }

    if (stats.examSolver >= 5 && !achievements.includes('exam-solver')) {
      newAchievements.push('exam-solver');
    }

    // Check badges based on usage patterns
    const badges = userData.badges || [];
    const newBadges = [];

    if (stats.aiTutor > stats.examSolver + stats.gpaCalculator && !badges.includes('ai-fan')) {
      newBadges.push('ai-fan');
    }

    if (stats.gpaCalculator >= 5 && !badges.includes('math-whiz')) {
      newBadges.push('math-whiz');
    }

    // Update if there are new achievements or badges
    if (newAchievements.length > 0 || newBadges.length > 0) {
      await userRef.update({
        achievements: [...achievements, ...newAchievements],
        badges: [...badges, ...newBadges]
      });
      console.log('New achievements unlocked:', newAchievements);
      console.log('New badges unlocked:', newBadges);
    }
  } catch (error) {
    console.error('Error checking achievements:', error);
  }
}

// Auto-track on page load for tools
document.addEventListener('DOMContentLoaded', function() {
  const currentPath = window.location.pathname;

  if (currentPath.includes('study-assistant.html')) {
    trackUsage('ai-tutor');
  } else if (currentPath.includes('exam-solver.html')) {
    trackUsage('exam-solver');
  } else if (currentPath.includes('gpa-calculator.html')) {
    trackUsage('gpa-calculator');
  } else if (currentPath.includes('pomodoro-timer.html')) {
    trackUsage('pomodoro-timer');
  }
});
