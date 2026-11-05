#!/bin/bash
set -e
echo "Initializing local BLAST+ environment..."
mkdir -p /blastdb
cd /blastdb
echo "Downloading the latest CARD Database..."
wget -O card_data.tar.bz2 https://card.mcmaster.ca/latest/data
echo "Locating nucleotide fasta file..."
FASTA_FILE=$(tar -tjf card_data.tar.bz2 | grep -i "nucleotide" | head -n 1)
if [ -z "$FASTA_FILE" ]; then
    echo "CRITICAL ERROR: Nucleotide fasta file not found in archive."
    exit 1
fi
echo "Extracting: $FASTA_FILE"
tar -xjf card_data.tar.bz2 "$FASTA_FILE"
echo "Compiling BLAST+ nucleotide database..."
makeblastdb -in "$FASTA_FILE" -dbtype nucl -out card_db
echo "Cleaning up raw files..."
rm card_data.tar.bz2 "$FASTA_FILE"
echo "MASTER CARD DATABASE COMPILED SUCCESSFULLY AT /blastdb/card_db"