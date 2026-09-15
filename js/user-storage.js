// User storage system for saving conversations, exams, and progress

const db = firebase.firestore();

async function saveConversation(toolName, conversationData) {
  try {
    const auth = firebase.auth();
    const user = auth.currentUser;

    if (!user) {
      alert('Debes iniciar sesión para guardar tus conversaciones');
      return false;
    }

    const userRef = db.collection('users').doc(user.email);
    const conversationsRef = userRef.collection('conversations');

    await conversationsRef.add({
      toolName: toolName,
      data: conversationData,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      title: conversationData.title || `${toolName} - ${new Date().toLocaleDateString()}`
    });

    return true;
  } catch (error) {
    console.error('Error saving conversation:', error);
    alert('Error al guardar la conversación');
    return false;
  }
}

async function loadConversations(toolName) {
  try {
    const auth = firebase.auth();
    const user = auth.currentUser;

    if (!user) {
      return [];
    }

    const userRef = db.collection('users').doc(user.email);
    const conversationsRef = userRef.collection('conversations');

    const snapshot = await conversationsRef
      .where('toolName', '==', toolName)
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();

    const conversations = [];
    snapshot.forEach(doc => {
      conversations.push({
        id: doc.id,
        ...doc.data()
      });
    });

    return conversations;
  } catch (error) {
    console.error('Error loading conversations:', error);
    return [];
  }
}

async function deleteConversation(conversationId) {
  try {
    const auth = firebase.auth();
    const user = auth.currentUser;

    if (!user) {
      return false;
    }

    const userRef = db.collection('users').doc(user.email);
    await userRef.collection('conversations').doc(conversationId).delete();

    return true;
  } catch (error) {
    console.error('Error deleting conversation:', error);
    return false;
  }
}

async function saveExam(examData) {
  try {
    const auth = firebase.auth();
    const user = auth.currentUser;

    if (!user) {
      alert('Debes iniciar sesión para guardar tus exámenes');
      return false;
    }

    const userRef = db.collection('users').doc(user.email);
    const examsRef = userRef.collection('exams');

    await examsRef.add({
      ...examData,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      title: examData.title || `Examen - ${new Date().toLocaleDateString()}`
    });

    return true;
  } catch (error) {
    console.error('Error saving exam:', error);
    alert('Error al guardar el examen');
    return false;
  }
}

async function loadExams() {
  try {
    const auth = firebase.auth();
    const user = auth.currentUser;

    if (!user) {
      return [];
    }

    const userRef = db.collection('users').doc(user.email);
    const examsRef = userRef.collection('exams');

    const snapshot = await examsRef
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();

    const exams = [];
    snapshot.forEach(doc => {
      exams.push({
        id: doc.id,
        ...doc.data()
      });
    });

    return exams;
  } catch (error) {
    console.error('Error loading exams:', error);
    return [];
  }
}

async function deleteExam(examId) {
  try {
    const auth = firebase.auth();
    const user = auth.currentUser;

    if (!user) {
      return false;
    }

    const userRef = db.collection('users').doc(user.email);
    await userRef.collection('exams').doc(examId).delete();

    return true;
  } catch (error) {
    console.error('Error deleting exam:', error);
    return false;
  }
}

async function saveProgress(toolName, progressData) {
  try {
    const auth = firebase.auth();
    const user = auth.currentUser;

    if (!user) {
      return false;
    }

    const userRef = db.collection('users').doc(user.email);
    const progressRef = userRef.collection('progress').doc(toolName);

    await progressRef.set({
      ...progressData,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    return true;
  } catch (error) {
    console.error('Error saving progress:', error);
    return false;
  }
}

async function loadProgress(toolName) {
  try {
    const auth = firebase.auth();
    const user = auth.currentUser;

    if (!user) {
      return null;
    }

    const userRef = db.collection('users').doc(user.email);
    const progressRef = userRef.collection('progress').doc(toolName);

    const doc = await progressRef.get();

    if (doc.exists) {
      return doc.data();
    }

    return null;
  } catch (error) {
    console.error('Error loading progress:', error);
    return null;
  }
}
