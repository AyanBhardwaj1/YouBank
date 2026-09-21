"use client";

import {
  Activity, AlertTriangle, ArrowLeftRight, BarChart3, BookOpen, Briefcase, Building2, Calculator, Calendar, CheckSquare, ClipboardList, Coins, Compass,
  CreditCard, Database, DollarSign, FileSearch, FileSpreadsheet, FileText, Flame, Globe, GraduationCap, Handshake, Landmark, Layers, LineChart, ListChecks,
  Mail, Map, MessageSquare, Network, Percent, PieChart, Presentation, Radar, Receipt, Scale, ScrollText, Search, Shield, Sparkles, Split, Target, TrendingDown,
  TrendingUp, Users, Wallet, Zap, Gauge, Banknote, BadgeDollarSign, Hourglass, Table, Settings, Palette, Home, Terminal, Rocket, Library, LogOut, ChevronRight, Play,
  Save, Copy, Download, RefreshCw, X, Plus, ArrowRight, Check, Bot, Cpu, Eye, Filter, Lightbulb, Star, Timer, Wand2, Bell, Lock, Layout, MousePointerClick, Building, FlaskConical, Stethoscope, Factory, Store, Radio, Fuel, Server, type LucideProps,
} from "lucide-react";

const MAP: Record<string, React.ComponentType<LucideProps>> = {
  Activity, AlertTriangle, ArrowLeftRight, BarChart3, BookOpen, Briefcase, Building2, Calculator, Calendar, CheckSquare, ClipboardList, Coins, Compass,
  CreditCard, Database, DollarSign, FileSearch, FileSpreadsheet, FileText, Flame, Globe, GraduationCap, Handshake, Landmark, Layers, LineChart, ListChecks,
  Mail, Map, MessageSquare, Network, Percent, PieChart, Presentation, Radar, Receipt, Scale, ScrollText, Search, Shield, Sparkles, Split, Target, TrendingDown,
  TrendingUp, Users, Wallet, Zap, Gauge, Banknote, BadgeDollarSign, Hourglass, Table, Settings, Palette, Home, Terminal, Rocket, Library, LogOut, ChevronRight, Play,
  Save, Copy, Download, RefreshCw, X, Plus, ArrowRight, Check, Bot, Cpu, Eye, Filter, Lightbulb, Star, Timer, Wand2, Bell, Lock, Layout, MousePointerClick, Building, FlaskConical, Stethoscope, Factory, Store, Radio, Fuel, Server,
  // Aliases for names packs may use
  Chart: BarChart3, BarChart: BarChart3, Trending: TrendingUp, Money: DollarSign, Doc: FileText, Document: FileText, List: ListChecks, Book: BookOpen, Graduation: GraduationCap, Bank: Landmark, People: Users, Waterfall: Layers, Grid: Table, Spreadsheet: FileSpreadsheet, Balance: Scale, Clock: Timer, Search2: FileSearch, Filing: ScrollText, Deal: Handshake, Fire: Flame,
};

/** Icon by lucide name with a safe fallback. Packs reference icons by string so they stay data. */
export function Icon({ name, className = "h-4 w-4", strokeWidth = 1.75 }: { name: string; className?: string; strokeWidth?: number }) {
  const C = MAP[name] ?? Sparkles;
  return <C className={className} strokeWidth={strokeWidth} aria-hidden />;
}
