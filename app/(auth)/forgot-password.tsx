// app/(auth)/forgot-password.tsx
import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { supabase } from "../../services/supabase";

type Step = "email" | "new_password";

export default function ForgotPasswordScreen() {
  const [step, setStep] = useState<Step>("email");

  // Auto-advance to step 2 if we arrive with an active recovery session
  // (user tapped the reset link in their email, which deep-linked here)
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) setStep("new_password");
    });
  }, []);
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // Step 1: send reset email
  const handleSendReset = async () => {
    if (!email) {
      Alert.alert("Missing email", "Please enter your email address.");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: "roam://reset-password",
    });
    setLoading(false);

    if (error) {
      Alert.alert("Error", error.message);
      return;
    }

    Alert.alert(
      "Check your email",
      "We sent a password reset link. Click it to return here and set a new password.",
    );
    setStep("new_password");
  };

  // Step 2: set new password (user arrives back via deep link with session)
  const handleSetPassword = async () => {
    if (!newPassword || !confirmPassword) {
      Alert.alert("Missing fields", "Please fill in both password fields.");
      return;
    }
    if (newPassword.length < 8) {
      Alert.alert("Too short", "Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert("Mismatch", "Passwords do not match.");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setLoading(false);

    if (error) {
      Alert.alert("Error", error.message);
      return;
    }

    Alert.alert("Password updated", "Your password has been changed.", [
      { text: "Sign in", onPress: () => router.replace("/(auth)/login") },
    ]);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.logo}>roam</Text>
          <Text style={styles.title}>
            {step === "email" ? "Reset password" : "New password"}
          </Text>
          <Text style={styles.subtitle}>
            {step === "email"
              ? "Enter your email and we'll send a reset link."
              : "Enter a new password for your account."}
          </Text>
        </View>

        <View style={styles.form}>
          {step === "email" ? (
            <>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor="#666"
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
              />
              <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={handleSendReset}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#1a1a2e" />
                ) : (
                  <Text style={styles.buttonText}>Send reset link</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => setStep("new_password")}
              >
                <Text style={styles.secondaryButtonText}>
                  Already have a reset code? Set new password
                </Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.label}>New password</Text>
              <TextInput
                style={styles.input}
                value={newPassword}
                onChangeText={setNewPassword}
                placeholder="••••••••"
                placeholderTextColor="#666"
                secureTextEntry
                autoComplete="new-password"
              />
              <Text style={styles.label}>Confirm password</Text>
              <TextInput
                style={styles.input}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder="••••••••"
                placeholderTextColor="#666"
                secureTextEntry
                autoComplete="new-password"
              />
              <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={handleSetPassword}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#1a1a2e" />
                ) : (
                  <Text style={styles.buttonText}>Update password</Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>

        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Text style={styles.backText}>← Back to sign in</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1a1a2e" },
  scroll: { flexGrow: 1, justifyContent: "center", padding: 24 },
  header: { alignItems: "center", marginBottom: 40 },
  logo: {
    fontSize: 40,
    fontWeight: "800",
    color: "#e8c547",
    letterSpacing: 4,
    marginBottom: 16,
  },
  title: { fontSize: 22, fontWeight: "700", color: "#fff", marginBottom: 8 },
  subtitle: {
    fontSize: 14,
    color: "#aaa",
    textAlign: "center",
    lineHeight: 20,
  },
  form: { width: "100%" },
  label: { color: "#ccc", fontSize: 14, marginBottom: 6, marginTop: 16 },
  input: {
    backgroundColor: "#2a2a3e",
    color: "#fff",
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    borderWidth: 1,
    borderColor: "#3a3a5e",
  },
  button: {
    backgroundColor: "#e8c547",
    borderRadius: 10,
    padding: 16,
    alignItems: "center",
    marginTop: 24,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#1a1a2e", fontSize: 16, fontWeight: "700" },
  secondaryButton: { alignItems: "center", marginTop: 16 },
  secondaryButtonText: { color: "#e8c547", fontSize: 13 },
  backButton: { alignItems: "center", marginTop: 32 },
  backText: { color: "#888", fontSize: 14 },
});
